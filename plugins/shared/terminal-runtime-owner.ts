import { FitAddon } from '@xterm/addon-fit'
import { LigaturesAddon } from '@xterm/addon-ligatures/lib/addon-ligatures.js'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { TerminalSocket } from './terminal-socket.ts'
import { TerminalOutputScheduler } from './terminal-output-scheduler.ts'
import { TerminalResizeHold } from './terminal-resize-hold.ts'
import { buildTerminalFontFamily } from './terminal-font.ts'
import { registerWebglAtlasTarget } from './terminal-webgl-atlas.ts'
import { RecentPtyOutputBuffer } from './recent-pty-output-buffer.ts'
import {
  armTerminalFitContinuationRetry,
  clearTerminalFitContinuationRetry,
} from './terminal-fit-retry.ts'
import {
  captureTerminalScrollState,
  restoreTerminalScrollState,
} from './terminal-scroll-snapshot.ts'
import {
  DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT,
  normalizeDesktopTerminalScrollbackRows,
  terminalOutputBacklogCapChars,
} from './terminal-scrollback-policy.ts'
import { resolveTerminalTheme } from './terminal-theme.ts'
import { computeTerminalImeAnchor } from './terminal-ime-anchor.ts'
import {
  INITIAL_TERMINAL_ACTIVITY,
  transitionTerminalActivity,
  type TerminalActivitySnapshot,
} from './terminal-activity.ts'
import {
  INITIAL_TERMINAL_SCROLL_INTENT,
  isTerminalScrollPinned,
  transitionTerminalScrollIntent,
  type TerminalScrollIntentState,
} from './terminal-scroll-intent.ts'

export type TerminalRuntimeOwnerStatus = 'connecting' | 'ready' | 'exited' | 'error'
export type TerminalRuntimeOwnerT = (key: string, params?: Record<string, unknown>) => string

export interface TerminalRuntimeOwnerOptions {
  sessionId: string
  tabId: string
  cwd?: string | null
  fontFamily: string
  fontSize: number
  scrollbackRows?: number
  mouseWheelMultiplier?: number
  ligatures?: boolean
  gpuAcceleration?: 'auto' | 'on' | 'off'
  onReady?(cwd: string): void
  onTitleChange?(title: string): void
  onLink?(uri: string): void
  onStatus?(status: TerminalRuntimeOwnerStatus, exitCode?: number | null): void
  t: TerminalRuntimeOwnerT
}

interface OwnerCallbacks {
  onReady: ((cwd: string) => void) | undefined
  onTitleChange: ((title: string) => void) | undefined
  onLink: ((uri: string) => void) | undefined
  onStatus: ((status: TerminalRuntimeOwnerStatus, exitCode?: number | null) => void) | undefined
  t: TerminalRuntimeOwnerT
}

const FIT_MIN_STABLE_FRAMES = 2
/** Minimum spacing between applied PTY resizes (SIGWINCH rate cap). */
const PTY_RESIZE_MIN_INTERVAL_MS = 50

/**
 * Module-level terminal owner. React surfaces attach a DOM host temporarily;
 * switching tabs detaches only layout observers and input listeners, leaving
 * xterm, socket, mode buffer, and output scheduler warm until explicit close.
 */
export class TerminalRuntimeOwner {
  readonly key: string
  readonly cwd: string | null | undefined
  readonly terminal: Terminal

  private readonly fitAddon = new FitAddon()
  private readonly searchAddon = new SearchAddon()
  private readonly serializeAddon = new SerializeAddon()
  private readonly unicode11Addon = new Unicode11Addon()
  private readonly webLinksAddon: WebLinksAddon
  private webglAddon: WebglAddon | null = null
  private ligaturesAddon: LigaturesAddon | null = null
  private readonly socket = new TerminalSocket()
  private readonly outputScheduler: TerminalOutputScheduler
  private readonly resizeHold: TerminalResizeHold
  private readonly recentBuffer = new RecentPtyOutputBuffer()
  private unregisterAtlasTarget: (() => void) | null = null
  private callbacks: OwnerCallbacks
  private container: HTMLDivElement | null = null
  private attached = false
  private opened = false
  private exited = false
  private disposed = false
  private rafId = 0
  private stableFrame = 0
  private lastProposed: { cols: number; rows: number } | null = null
  private resizeObserver: ResizeObserver | null = null
  private inputSubscription: { dispose(): void } | null = null
  private resizeSubscription: { dispose(): void } | null = null
  private titleSubscription: { dispose(): void } | null = null
  private scrollSubscription: { dispose(): void } | null = null
  private writeParsedSubscription: { dispose(): void } | null = null
  private themeObserver: MutationObserver | null = null
  private compositionHandler: (() => void) | null = null
  private scrollIntent: TerminalScrollIntentState = INITIAL_TERMINAL_SCROLL_INTENT
  private activity: TerminalActivitySnapshot = INITIAL_TERMINAL_ACTIVITY
  private gpuAcceleration: 'auto' | 'on' | 'off' = 'auto'

  constructor(options: TerminalRuntimeOwnerOptions) {
    this.key = `${options.sessionId}:${options.tabId}`
    this.cwd = options.cwd
    this.callbacks = {
      onReady: options.onReady,
      onTitleChange: options.onTitleChange,
      onLink: options.onLink,
      onStatus: options.onStatus,
      t: options.t,
    }
    const resolvedFontFamily = buildTerminalFontFamily(options.fontFamily)
    const resolvedFontSize = Number.isFinite(options.fontSize) && options.fontSize >= 9 && options.fontSize <= 32
      ? options.fontSize
      : 13
    this.terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: resolvedFontFamily,
      fontSize: resolvedFontSize,
      scrollback: normalizeDesktopTerminalScrollbackRows(
        options.scrollbackRows ?? DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT,
      ),
      scrollSensitivity: normalizeWheel(options.mouseWheelMultiplier),
      // xterm 6.1 renders its own DOM scrollbar; the width reserves a gutter
      // that FitAddon accounts for, so the bar never covers content (same
      // choice as Orca/VS Code: 7px).
      scrollbar: {
        width: 7,
        showArrows: false,
      },
      theme: resolveTerminalTheme(),
    })
    this.webLinksAddon = new WebLinksAddon((_event, uri) => {
      const open = this.callbacks.onLink
      if (open !== undefined) open(uri)
      else window.open(uri, '_blank', 'noopener,noreferrer')
    })
    this.outputScheduler = new TerminalOutputScheduler(this.terminal, {
      maxQueuedChars: terminalOutputBacklogCapChars(
        options.scrollbackRows ?? DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT,
      ),
      onParseStall: () => {
        this.outputScheduler.reset()
        this.socket.recover()
      },
      onWriteFailure: () => {
        this.outputScheduler.reset()
        this.socket.recover()
      },
    })
    this.resizeHold = new TerminalResizeHold(dimensions => {
      this.socket.sendResize(dimensions.cols, dimensions.rows)
    }, undefined, PTY_RESIZE_MIN_INTERVAL_MS)
  }

  update(options: TerminalRuntimeOwnerOptions): void {
    if (this.disposed) return
    this.callbacks = {
      onReady: options.onReady,
      onTitleChange: options.onTitleChange,
      onLink: options.onLink,
      onStatus: options.onStatus,
      t: options.t,
    }
    const resolvedFontFamily = buildTerminalFontFamily(options.fontFamily)
    const resolvedFontSize = Number.isFinite(options.fontSize) && options.fontSize >= 9 && options.fontSize <= 32
      ? options.fontSize
      : 13
    this.terminal.options.fontFamily = resolvedFontFamily
    this.terminal.options.fontSize = resolvedFontSize
    this.terminal.options.scrollback = normalizeDesktopTerminalScrollbackRows(
      options.scrollbackRows ?? DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT,
    )
    this.terminal.options.scrollSensitivity = normalizeWheel(options.mouseWheelMultiplier)
    this.gpuAcceleration = options.gpuAcceleration ?? 'auto'
    this.setLigatures(options.ligatures === true)
    this.setGpuAcceleration(this.gpuAcceleration)
    this.fitNow()
  }

  attach(container: HTMLDivElement, options: TerminalRuntimeOwnerOptions): void {
    if (this.disposed) return
    this.update(options)
    this.container = container
    if (!this.opened) {
      this.terminal.open(container)
      this.terminal.loadAddon(this.fitAddon)
      this.terminal.loadAddon(this.searchAddon)
      this.terminal.loadAddon(this.serializeAddon)
      this.terminal.loadAddon(this.unicode11Addon)
      this.terminal.loadAddon(this.webLinksAddon)
      try {
        this.terminal.unicode.activeVersion = '11'
      } catch {
        // Fallback to default unicode table if version 11 unavailable
      }
      this.opened = true
      this.installPersistentListeners()
      this.socket.connect(this.terminal.cols, this.terminal.rows, {
        onOutput: (data, acknowledge) => {
          this.recentBuffer.append(data)
          this.publishActivity(transitionTerminalActivity(this.activity, {
            type: 'output',
            attached: this.attached,
          }))
          this.outputScheduler.enqueue(data, acknowledge)
        },
        onReady: cwd => {
          this.callbacks.onStatus?.('ready')
          this.callbacks.onReady?.(cwd)
        },
        onExit: code => this.markExited(code),
        onError: message => {
          this.publishActivity(transitionTerminalActivity(this.activity, { type: 'attention' }))
          if (!this.exited) this.callbacks.onStatus?.('error')
          this.outputScheduler.enqueue(`\r\n\x1b[31m[${this.callbacks.t('terminal.error', { message })}]\x1b[0m\r\n`)
        },
      }, {
        sessionId: options.sessionId,
        tabId: options.tabId,
        ...(options.cwd?.trim() ? { cwd: options.cwd.trim() } : {}),
      })
    } else {
      const element = this.terminal.element
      if (element !== undefined && element.parentElement !== container) container.appendChild(element)
    }
    this.attached = true
    this.publishActivity(transitionTerminalActivity(this.activity, { type: 'reveal' }))
    this.attachSurfaceListeners()
    this.installWebgl(options.gpuAcceleration ?? 'auto')
    this.setLigatures(options.ligatures === true)
    this.fitNow()
    this.terminal.focus()
  }

  detach(): void {
    if (!this.attached) return
    this.attached = false
    if (this.rafId !== 0) cancelAnimationFrame(this.rafId)
    this.rafId = 0
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.inputSubscription?.dispose()
    this.inputSubscription = null
    this.resizeSubscription?.dispose()
    this.resizeSubscription = null
    this.resizeHold.cancel()
    clearTerminalFitContinuationRetry(this)
    if (this.compositionHandler !== null) {
      this.terminal.element?.removeEventListener('compositionstart', this.compositionHandler)
      this.terminal.element?.removeEventListener('compositionupdate', this.compositionHandler)
      this.compositionHandler = null
    }
    const element = this.terminal.element
    const container = this.container
    if (element !== undefined && container !== null && element.parentElement === container) container.removeChild(element)
    this.container = null
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.detach()
    this.unregisterAtlasTarget?.()
    this.unregisterAtlasTarget = null
    clearTerminalFitContinuationRetry(this)
    this.recentBuffer.clear()
    this.socket.terminate()
    this.outputScheduler.dispose()
    this.titleSubscription?.dispose()
    this.scrollSubscription?.dispose()
    this.writeParsedSubscription?.dispose()
    this.themeObserver?.disconnect()
    if (this.compositionHandler !== null) {
      this.terminal.element?.removeEventListener('compositionstart', this.compositionHandler)
      this.terminal.element?.removeEventListener('compositionupdate', this.compositionHandler)
    }
    try { this.webglAddon?.dispose() } catch { /* best effort */ }
    try { this.ligaturesAddon?.dispose() } catch { /* best effort */ }
    try { this.searchAddon.dispose() } catch { /* best effort */ }
    try { this.serializeAddon.dispose() } catch { /* best effort */ }
    try { this.unicode11Addon.dispose() } catch { /* best effort */ }
    try { this.webLinksAddon.dispose() } catch { /* best effort */ }
    try { this.fitAddon.dispose() } catch { /* best effort */ }
    try { this.terminal.dispose() } catch { /* best effort */ }
  }

  private installPersistentListeners(): void {
    this.titleSubscription = this.terminal.onTitleChange(title => this.callbacks.onTitleChange?.(title))
    this.terminal.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown' || !event.shiftKey || !(event.ctrlKey || event.metaKey)) return true
      if (event.key.toLowerCase() !== 'f') return true
      const query = window.prompt('Search terminal', '')
      if (query !== null && query !== '') this.searchAddon.findNext(query)
      return false
    })
    this.scrollSubscription = this.terminal.onScroll(() => {
      const buffer = this.terminal.buffer.active
      this.publishScrollIntent(transitionTerminalScrollIntent(this.scrollIntent, {
        type: 'user-scroll',
        atBottom: buffer.viewportY >= buffer.baseY,
      }))
    })
    this.writeParsedSubscription = this.terminal.onWriteParsed(() => {
      const next = transitionTerminalScrollIntent(this.scrollIntent, { type: 'programmatic-output' })
      this.publishScrollIntent(next)
      if (isTerminalScrollPinned(next)) this.terminal.scrollToBottom()
    })
    this.themeObserver = new MutationObserver(() => {
      this.terminal.options.theme = resolveTerminalTheme()
    })
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-ds-dark-theme'],
    })
  }

  private attachSurfaceListeners(): void {
    const container = this.container
    if (container === null) return
    this.inputSubscription = this.terminal.onData(data => {
      this.publishActivity(transitionTerminalActivity(this.activity, { type: 'input' }))
      this.socket.sendInput(data)
    })
    this.resizeSubscription = this.terminal.onResize(dimensions => this.resizeHold.request(dimensions))
    this.compositionHandler = () => {
      const element = this.terminal.element
      const textarea = this.terminal.textarea
      const screen = element?.querySelector<HTMLElement>('.xterm-screen')
      if (element === undefined || textarea === undefined || screen === null || screen === undefined) return
      const rect = screen.getBoundingClientRect()
      const cellWidth = rect.width / Math.max(1, this.terminal.cols)
      const cellHeight = rect.height / Math.max(1, this.terminal.rows)
      if (!(cellWidth > 0) || !(cellHeight > 0)) return
      const buffer = this.terminal.buffer.active
      const anchor = computeTerminalImeAnchor({
        cursor: { row: buffer.cursorY, col: buffer.cursorX },
        rows: this.terminal.rows,
        cols: this.terminal.cols,
      })
      textarea.style.top = `${anchor.row * cellHeight}px`
      textarea.style.left = `${anchor.col * cellWidth}px`
    }
    this.terminal.element?.addEventListener('compositionstart', this.compositionHandler)
    this.terminal.element?.addEventListener('compositionupdate', this.compositionHandler)
    let stableFrame = 0
    let lastProposed: { cols: number; rows: number } | null = null
    const scheduleStableFit = (): void => {
      if (this.rafId !== 0 || !this.attached) return
      this.rafId = requestAnimationFrame(() => {
        this.rafId = 0
        if (!this.attached || this.container === null) return
        let proposed: { cols: number; rows: number } | null = null
        try { proposed = this.fitAddon.proposeDimensions() ?? null } catch { proposed = null }
        if (proposed === null) {
          stableFrame = 0
          lastProposed = null
          return
        }
        if (proposed.cols === this.terminal.cols && proposed.rows === this.terminal.rows) {
          stableFrame = 0
          lastProposed = null
          return
        }
        // Two consecutive identical proposals: the layout settled — fit now.
        if (lastProposed !== null && lastProposed.cols === proposed.cols
          && lastProposed.rows === proposed.rows && stableFrame >= FIT_MIN_STABLE_FRAMES - 1) {
          stableFrame = 0
          lastProposed = null
          this.fitNow()
          return
        }
        lastProposed = proposed
        stableFrame += 1
        // Continuous resize (sidebar/split drag): the proposal changes every
        // frame, and each fit re-rasterizes the canvas and SIGWINCHes the
        // shell — which reads as screen flicker. While the size keeps
        // changing NO fit is issued (mirrors the resize-debounce strategy of
        // VS Code / Orca); the stable-proposal path above fits immediately
        // the moment the drag stops, so the terminal snaps to the final grid
        // without flashing through every intermediate size.
        scheduleStableFit()
      })
    }
    this.resizeObserver = new ResizeObserver(() => {
      scheduleStableFit()
      if (this.container !== null && this.container.clientWidth > 0 && this.container.clientHeight > 0) {
        this.publishScrollIntent(transitionTerminalScrollIntent(this.scrollIntent, { type: 'reveal' }))
        const buffer = this.terminal.buffer.active
        if (buffer.viewportY >= buffer.baseY) {
          this.publishScrollIntent(transitionTerminalScrollIntent(this.scrollIntent, { type: 'return-to-bottom' }))
        }
        if (this.webglAddon === null && this.gpuAcceleration !== 'off') {
          this.installWebgl(this.gpuAcceleration)
        }
      }
    })
    this.resizeObserver.observe(container)
  }

  get recentOutputTranscript(): string {
    return this.recentBuffer.read()
  }

  private fitNow(): boolean {
    if (!this.attached || this.container === null
      || this.container.clientWidth === 0 || this.container.clientHeight === 0) {
      armTerminalFitContinuationRetry(this, {
        retry: () => this.fitNow(),
      })
      return false
    }
    clearTerminalFitContinuationRetry(this)
    try {
      const proposed = this.fitAddon.proposeDimensions()
      if (proposed === undefined || (proposed.cols === this.terminal.cols && proposed.rows === this.terminal.rows)) return true
      const snapshot = captureTerminalScrollState(this.terminal)
      this.fitAddon.fit()
      restoreTerminalScrollState(this.terminal, snapshot)
      return true
    } catch {
      armTerminalFitContinuationRetry(this, {
        retry: () => this.fitNow(),
      })
      return false
    }
  }

  private markExited(code: number | null): void {
    if (this.exited) return
    this.exited = true
    this.publishActivity(transitionTerminalActivity(this.activity, { type: 'exit' }))
    this.callbacks.onStatus?.('exited', code)
    this.outputScheduler.enqueue(`\r\n\x1b[90m[${this.callbacks.t('terminal.process-exited', {
      code: code ?? this.callbacks.t('terminal.unknown'),
    })}]\x1b[0m\r\n`)
  }

  private publishScrollIntent(next: TerminalScrollIntentState): void {
    this.scrollIntent = next
    if (this.container !== null) {
      this.container.dataset.terminalScrollIntent = next.intent
      this.container.dataset.terminalUnseenOutput = String(next.unseenOutput)
    }
  }

  private publishActivity(next: TerminalActivitySnapshot): void {
    this.activity = next
    if (this.container !== null) {
      this.container.dataset.terminalActivity = next.state
      this.container.dataset.terminalUnreadOutput = String(next.unreadOutput)
    }
  }

  private installWebgl(mode: 'auto' | 'on' | 'off'): void {
    if (mode === 'off' || this.webglAddon !== null || !this.opened) return
    try {
      const addon = new WebglAddon()
      addon.onContextLoss(() => {
        if (this.webglAddon !== addon) return
        this.webglAddon = null
        this.unregisterAtlasTarget?.()
        this.unregisterAtlasTarget = null
        try { addon.dispose() } catch { /* fallback */ }
        try { this.terminal.refresh(0, this.terminal.rows - 1) } catch { /* disposed */ }
      })
      this.terminal.loadAddon(addon)
      this.webglAddon = addon
      this.unregisterAtlasTarget = registerWebglAtlasTarget({
        resetWebglTextureAtlas: () => {
          try { (addon as unknown as { clearTextureAtlas?(): void }).clearTextureAtlas?.() } catch { /* best effort */ }
        },
        refreshTerminal: () => {
          try { this.terminal.refresh(0, this.terminal.rows - 1) } catch { /* disposed */ }
        },
      })
      this.terminal.refresh(0, this.terminal.rows - 1)
    } catch {
      this.webglAddon = null
      this.unregisterAtlasTarget?.()
      this.unregisterAtlasTarget = null
    }
  }

  private setGpuAcceleration(mode: 'auto' | 'on' | 'off'): void {
    if (mode === 'off') {
      const addon = this.webglAddon
      this.webglAddon = null
      try { addon?.dispose() } catch { /* best effort */ }
      return
    }
    this.installWebgl(mode)
  }

  private setLigatures(enabled: boolean): void {
    if (enabled && this.ligaturesAddon === null && this.opened) {
      try {
        const addon = new LigaturesAddon()
        this.terminal.loadAddon(addon)
        this.ligaturesAddon = addon
        this.terminal.refresh(0, this.terminal.rows - 1)
      } catch {
        this.ligaturesAddon = null
      }
    } else if (!enabled && this.ligaturesAddon !== null) {
      const addon = this.ligaturesAddon
      this.ligaturesAddon = null
      try { addon.dispose() } catch { /* best effort */ }
      try { this.terminal.refresh(0, this.terminal.rows - 1) } catch { /* disposed */ }
    }
  }
}

const owners = new Map<string, TerminalRuntimeOwner>()

export function getTerminalRuntimeOwner(
  options: TerminalRuntimeOwnerOptions,
): TerminalRuntimeOwner {
  const key = `${options.sessionId}:${options.tabId}`
  const existing = owners.get(key)
  if (existing !== undefined && existing.cwd === options.cwd) return existing
  if (existing !== undefined) {
    owners.delete(key)
    existing.dispose()
  }
  const owner = new TerminalRuntimeOwner(options)
  owners.set(key, owner)
  return owner
}

export function disposeTerminalRuntimeOwner(sessionId: string, tabId: string): void {
  const key = `${sessionId}:${tabId}`
  const owner = owners.get(key)
  if (owner === undefined) return
  owners.delete(key)
  owner.dispose()
}

;(globalThis as typeof globalThis & {
  __dshStudioTerminalRuntimeOwner?: { dispose(sessionId: string, tabId: string): void }
}).__dshStudioTerminalRuntimeOwner = { dispose: disposeTerminalRuntimeOwner }

export function disposeAllTerminalRuntimeOwners(): void {
  for (const [key, owner] of [...owners]) {
    owners.delete(key)
    owner.dispose()
  }
}

function normalizeWheel(value: number | undefined): number {
  return Math.min(4, Math.max(0.25, value ?? 1))
}

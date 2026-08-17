import { Fragment } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import xtermCss from '@xterm/xterm/css/xterm.css'
import terminalCss from './terminal.css'
import themeCss from '../../../shared/theme.css'
import { TerminalPanel, openOrToggleTerminal } from './TerminalPanel.tsx'
import {
  createMountScheduler,
  findConversationColumn,
  mutationNeedsMount,
} from '../../../shared/column-mount.ts'
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  createDockStore,
  hasPersistedDockState,
  terminalFontPrefActions,
  type DockStore,
} from './panel-store.ts'
import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import { TERMINAL_MESSAGES, type TerminalMessage } from './i18n.ts'

interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface SessionSummary {
  cwd?: string
}

interface SessionListState {
  current?: string
  byId: Record<string, SessionSummary>
}

interface SessionsService {
  list: ObservableSnapshot<SessionListState>
}

interface LayoutService {
  toggleSidebar(): void
}

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

interface SessionSurface {
  scopeKey: string
  cwd: string | null
  store: DockStore
}

interface ReactMount {
  element: HTMLDivElement | null
  root: Root | null
}

/**
 * One right-panel owner's footprint claim. Only the most recently claimed
 * owner applies: the coordinator owns `data-oh-dsh-right-panel-owner` and
 * the `#root` squeeze, so plugins no longer race over global state.
 */
export interface RightPanelClaim {
  /**
   * CSS padding-right applied to #root while this claim is active, or null
   * when the owner only wants the flag (no squeeze). `box-sizing: border-box`
   * is applied together with a non-null squeeze and removed on release.
   */
  paddingRight: string | null
}

export interface DesktopPanels {
  claimRightPanel(ownerId: string, claim: RightPanelClaim): void
  isBottomPanelOpen(): boolean
  releaseRightPanel(ownerId: string): void
  setAutoOpenTerminal(enabled: boolean): void
  /**
   * Apply the GLOBAL terminal font preferences (from the sidebar settings
   * page): an empty family keeps the dock's own font, a size within the
   * 9–32 range applies live to the active dock; brand-new docks (no
   * persisted per-session font) are seeded with them. Existing docks keep
   * their per-session font until the user changes one of these prefs.
   */
  setTerminalFontPreferences(family: string, size: number): void
  subscribe(listener: () => void): () => void
  toggleBottomPanel(): void
  toggleSidebar(): void
}

export const inject = ['layout', 'locale', 'sessions']

function currentSession(sessions: SessionsService): { scopeKey: string; cwd: string | null } {
  const snapshot = sessions.list.getSnapshot()
  const sessionId = snapshot.current
  return {
    scopeKey: sessionId ?? 'new-session',
    cwd: sessionId === undefined ? null : snapshot.byId[sessionId]?.cwd ?? null,
  }
}

class DesktopPanelService implements DesktopPanels {
  private readonly listeners = new Set<() => void>()
  private readonly layout: LayoutService
  private readonly sessions: SessionsService
  private readonly surfaces = new Map<string, SessionSurface>()
  private readonly rightPanelClaims = new Map<string, RightPanelClaim>()
  private readonly rightPanelOrder: string[] = []
  private active: SessionSurface | undefined
  private readonly dock: ReactMount = { element: null, root: null }
  private style: HTMLStyleElement | undefined
  private observer: MutationObserver | undefined
  private stopSessionSubscription: (() => void) | undefined
  private stopActiveStoreSubscription: (() => void) | undefined
  private scheduler: ReturnType<typeof createMountScheduler> | undefined
  private autoOpenTerminal = true
  private terminalFontFamily = ''
  private terminalFontSize = DEFAULT_TERMINAL_FONT_SIZE
  /** Startup sync (the very first `setTerminalFontPreferences`) only seeds
   *  FRESH docks; live application to the active dock starts after it, so a
   *  persisted per-dock font is never clobbered at mount. */
  private fontsInitialized = false

  constructor(
    layout: LayoutService,
    private readonly locale: LocaleService,
    private readonly t: Translate<TerminalMessage>,
    sessions: SessionsService,
  ) {
    this.layout = layout
    this.sessions = sessions
  }

  mount(): void {
    this.style = document.createElement('style')
    this.style.dataset.ohDshTerminalStyles = 'true'
    this.style.textContent = `${themeCss}\n${xtermCss}\n${terminalCss}`
    document.head.append(this.style)
    this.scheduler = createMountScheduler(() => { this.mountAll() })
    this.syncActiveSession()
    this.stopSessionSubscription = this.sessions.list.subscribe(() => { this.syncActiveSession() })
    this.mountAll()
    this.observer = new MutationObserver(records => {
      if (records.some(record => mutationNeedsMount(record, '#oh-dsh-terminal-root'))) {
        this.scheduler?.schedule()
      }
    })
    this.observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-details-collapsed', 'data-sidebar-collapsed'],
      childList: true,
      subtree: true,
    })
  }

  dispose(): void {
    this.stopSessionSubscription?.()
    this.stopActiveStoreSubscription?.()
    this.observer?.disconnect()
    this.scheduler?.cancel()
    this.dock.root?.unmount()
    this.dock.element?.remove()
    this.style?.remove()
    this.surfaces.clear()
    this.active = undefined
    this.rightPanelClaims.clear()
    this.rightPanelOrder.length = 0
    this.applyRightPanel()
  }

  isBottomPanelOpen(): boolean {
    return this.active !== undefined && !this.active.store.getState().collapsed
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Claim the right panel footprint for one owner. The most recently claimed
   * owner wins; earlier claims stay registered so their release can never
   * clear another owner's squeeze. Opening one panel while another is open is
   * mutual-excluded by the callers, so a single active owner is the norm.
   */
  claimRightPanel(ownerId: string, claim: RightPanelClaim): void {
    this.rightPanelClaims.set(ownerId, claim)
    const index = this.rightPanelOrder.indexOf(ownerId)
    if (index !== -1) this.rightPanelOrder.splice(index, 1)
    this.rightPanelOrder.push(ownerId)
    this.applyRightPanel()
  }

  /** Drop an owner's claim; releases the squeeze when it was the active one. */
  releaseRightPanel(ownerId: string): void {
    this.rightPanelClaims.delete(ownerId)
    const index = this.rightPanelOrder.indexOf(ownerId)
    if (index !== -1) this.rightPanelOrder.splice(index, 1)
    this.applyRightPanel()
  }

  private applyRightPanel(): void {
    const html = document.documentElement
    const ownerId = this.rightPanelOrder[this.rightPanelOrder.length - 1]
    const claim = ownerId === undefined ? undefined : this.rightPanelClaims.get(ownerId)
    const appRoot = document.getElementById('root')
    if (claim !== undefined && ownerId !== undefined) {
      html.dataset.ohDshRightPanelOwner = ownerId
      if (claim.paddingRight === null) {
        appRoot?.style.removeProperty('padding-right')
        appRoot?.style.removeProperty('box-sizing')
      } else {
        appRoot?.style.setProperty('box-sizing', 'border-box')
        appRoot?.style.setProperty('padding-right', claim.paddingRight)
      }
    } else {
      delete html.dataset.ohDshRightPanelOwner
      appRoot?.style.removeProperty('padding-right')
      appRoot?.style.removeProperty('box-sizing')
    }
  }

  setAutoOpenTerminal(enabled: boolean): void {
    this.autoOpenTerminal = enabled
  }

  setTerminalFontPreferences(family: string, size: number): void {
    this.terminalFontFamily = family
    this.terminalFontSize = size
    if (this.active === undefined) return
    if (!this.fontsInitialized) {
      // Startup read: fresh docks are seeded in surfaceFor; the active —
      // possibly persisted — dock keeps its font.
      this.fontsInitialized = true
      return
    }
    this.applyTerminalFontTo(this.active.store)
  }

  /** Apply the stored GLOBAL font prefs to one dock store (idempotent:
   *  default values produce no actions, so persisted per-dock fonts are
   *  never clobbered at startup). */
  private applyTerminalFontTo(store: DockStore): void {
    for (const action of terminalFontPrefActions(this.terminalFontFamily, this.terminalFontSize)) {
      store.dispatch(action)
    }
  }

  toggleBottomPanel(): void {
    if (this.active === undefined) this.syncActiveSession()
    if (this.active === undefined) return
    const state = this.active.store.getState()
    if (state.tabs.length === 0 && !this.autoOpenTerminal) {
      this.active.store.dispatch({ type: 'toggle-collapsed' })
      return
    }
    openOrToggleTerminal(this.active.store)
  }

  toggleSidebar(): void {
    this.layout.toggleSidebar()
  }

  private surfaceFor(scopeKey: string, cwd: string | null): SessionSurface {
    const existing = this.surfaces.get(scopeKey)
    if (existing !== undefined) {
      existing.cwd = cwd
      return existing
    }
    const store = createDockStore(window.localStorage, scopeKey)
    // A brand-new session dock (no persisted per-session font) is seeded
    // with the global terminal font preferences; a dock that already has a
    // persisted font keeps it.
    if (!hasPersistedDockState(window.localStorage, scopeKey)) {
      this.applyTerminalFontTo(store)
    }
    const surface = {
      scopeKey,
      cwd,
      store,
    }
    this.surfaces.set(scopeKey, surface)
    return surface
  }

  private syncActiveSession(): void {
    const session = currentSession(this.sessions)
    const previous = this.active
    const previousCwd = previous?.cwd
    const next = this.surfaceFor(session.scopeKey, session.cwd)
    if (previous === next && previousCwd === session.cwd) return
    if (previous !== next) {
      this.stopActiveStoreSubscription?.()
      this.stopActiveStoreSubscription = next.store.subscribe(() => { this.notify() })
    }
    this.active = next
    this.renderDock()
    this.scheduler?.schedule()
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  private mountAll(): void {
    const column = findConversationColumn()
    if (column === null) return
    this.mountDock(column)
  }

  private mountDock(column: HTMLElement): void {
    if (this.dock.element === null) {
      const element = document.createElement('div')
      element.id = 'oh-dsh-terminal-root'
      element.style.display = 'contents'
      this.dock.element = element
      this.dock.root = createRoot(element)
    }
    if (this.dock.element.parentElement !== column || column.lastElementChild !== this.dock.element) {
      column.append(this.dock.element)
    }
    this.renderDock()
  }

  private renderDock(): void {
    const active = this.active
    if (this.dock.root === null || active === undefined) return
    this.dock.root.render(
      <Fragment>
        {[...this.surfaces.values()].map(surface => (
          <div
            key={surface.scopeKey}
            style={{ display: surface === active ? 'contents' : 'none' }}
          >
            <TerminalPanel
              locale={this.locale}
              t={this.t}
              store={surface.store}
              scopeKey={surface.scopeKey}
              cwd={surface.cwd}
              active={surface === active}
            />
          </div>
        ))}
      </Fragment>,
    )
  }
}

export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  const t: Translate<TerminalMessage> = locale.bind('oh-dsh.terminal')
  ctx.effect(
    () => locale.register('oh-dsh.terminal', TERMINAL_MESSAGES),
    'oh-dsh-desktop: terminal dictionaries',
  )
  const service = new DesktopPanelService(
    ctx.get('layout') as LayoutService,
    locale,
    t,
    ctx.get('sessions') as SessionsService,
  )
  ctx.effect(() => {
    service.mount()
    const removeService = ctx.reflect.provide('desktopPanels', service, undefined)
    return () => {
      service.dispose()
      void removeService?.()
    }
  }, 'oh-dsh-desktop: terminal panel controls')
}

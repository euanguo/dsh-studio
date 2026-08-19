/**
 * Center surface host: the middle-area tab strip + active surface body.
 *
 * Mounts a fixed overlay (`#oh-dsh-center-tabs-root`) spanning the center
 * column — between the DSH left sidebar (measured) and the desktop right
 * panel. Conversation tabs come from the sessions service (the current
 * project's sessions); file/diff/browser surfaces open as preview tabs
 * (single click replaces, double click pins).
 *
 * When a conversation tab is active the body is hidden so the DSH
 * conversation is visible; any other surface kind renders its body over
 * the center column.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Translate } from '@oh-dsh/shared/i18n'
import {
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  IconExternalLink,
  IconFile,
  IconFileDiff,
  IconGitBranch,
  IconGitCommit,
  IconHistory,
  IconPlus,
  IconSidebarLeftFilled,
  IconSidebarRightFilled,
  IconTerminal,
  getIconForFile,
} from '@oh-dsh/shared/tabler-icons'
import type { WorkspaceMessage } from '../i18n.ts'
import { ErrorView } from '../kit/status.tsx'
import { centerColumnElement, leftRailToggleButton, readLeftRailOpen } from './dsh-dom.ts'
import type { SessionsService, WorkspacesService } from '../client-types.ts'
import { sidebarApi } from '../sidebar-api.ts'
import {
  canOpenTerminalInstance,
  releaseTerminalInstance,
  touchTerminalInstance,
} from '../runtimes/terminal-runtime.ts'
import type { SidebarSnapshot, SidebarTabSeed } from '../contract.ts'
import {
  persistCenterSurfaces,
  restoreCenterSurfaces,
  useCenterSurfaceStore,
} from './center-surface-store.ts'
import {
  resolveActiveSurface,
  conversationSurfaceId,
  type CenterSurface,
  type CenterSurfaceSlice,
} from './types.ts'
import {
  SurfaceTab,
  SurfaceTabStrip,
} from '@oh-dsh/shared/surface-tab'
import {
  DiffThemeSync,
  DiffWorkerPoolProvider,
} from '../diff/pierre-adapter.tsx'

/** Extract the file basename from a path for icon lookup. */
function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? 'file'
}

/** File-type icon matching the right-panel file tree (VSCode Material style). */
function fileTypeIcon(filePath: string): JSX.Element {
  return getIconForFile({ fileName: fileNameFromPath(filePath), autoAssign: true, width: 13, height: 13 })
}

function surfaceIcon(surface: CenterSurface): JSX.Element | null {
  if (surface.kind === 'conversation') return <IconFile size={13} />
  if (surface.kind === 'file') return fileTypeIcon(surface.filePath)
  if (surface.kind === 'diff') return <IconGitBranch size={13} />
  if (surface.kind === 'diff-all') return <IconGitBranch size={13} />
  if (surface.kind === 'commit') return <IconHistory size={13} />
  if (surface.kind === 'commit-file') return <IconFileDiff size={13} />
  if (surface.kind === 'committed') return <IconGitCommit size={13} />
  if (surface.kind === 'browser') return <IconExternalLink size={13} />
  if (surface.kind === 'terminal') return <IconTerminal size={13} />
  return null
}

function sessionShortId(sessionId: string): string {
  return `#${sessionId.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase() || '?'}`
}

/** Human tab label for a conversation: the session title, then the project
 *  basename, then the raw id (matches the host's displayTitle projection). */
function conversationTabTitle(
  sessionId: string,
  cwd: string | undefined,
  summary?: { title?: string; displayTitle?: string },
): string {
  if (summary?.displayTitle !== undefined && summary.displayTitle !== '') {
    return summary.displayTitle
  }
  if (summary?.title !== undefined && summary.title !== '') {
    return summary.title
  }
  if (cwd !== undefined && cwd !== '') {
    const base = cwd.replaceAll('\\', '/').replace(/\/+$/, '').split('/').at(-1)
    if (base !== undefined && base !== '') return base
  }
  return sessionShortId(sessionId)
}

export function CenterSurfaceTabs({
  sessions,
  t,
}: {
  sessions: SessionsService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const sessionList = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  const current = sessionList.current
  // The active workspace: every project keeps its own tab queue, and
  // switching workspaces swaps the whole queue (like Git/file lists).
  const cwd = current === undefined ? undefined : sessionList.byId[current]?.cwd
  const slice = useCenterSurfaceStore(state =>
    cwd === undefined ? EMPTY_CENTER_SLICE : state.getSlice(cwd))

  // The current project's sessions (same cwd as the active session), the
  // current session included — it must show as the active tab, and the
  // "new conversation" blank placeholder is not a real tab.
  const conversationTabs = useMemo(() => {
    if (cwd === undefined) return []
    return Object.entries(sessionList.byId)
      .filter(([id, summary]) => summary.cwd === cwd && !summary.blank)
      .map(([id, summary]) => ({ id, cwd: summary.cwd!, summary }))
  }, [cwd, sessionList])

  // Keep the open set in sync with the session list WITHOUT re-listing every
  // project conversation: a conversation is an ordinary center tab, so the
  // open set is a WHITELIST — restore brings back only what the user had
  // open (never all of the project's sessions), and closing a tab persists
  // its removal. The one guarantee: NAVIGATING within the SAME project (the
  // active session changed while the cwd did not — a left-rail click, a
  // session switch, a fork/new) opens that conversation's tab, exactly like
  // clicking a file opens a file tab. Entering/returning to a project
  // (cwd changed) is a RESTORE, not a navigation: only the persisted open[]
  // whitelist comes back, so a conversation the user closed before leaving
  // the project stays closed. Removed sessions drop their tab.
  const prevCwdRef = useRef<string | undefined>(undefined)
  const prevCurrentByCwdRef = useRef<Record<string, string | undefined>>({})
  useEffect(() => {
    if (cwd === undefined) return
    const state = useCenterSurfaceStore.getState()
    const workspaceSlice = state.getSlice(cwd)
    const validIds = new Set(conversationTabs.map(tab => conversationSurfaceId(tab.id)))
    const cwdChanged = prevCwdRef.current !== cwd
    const prevCurrent = prevCurrentByCwdRef.current[cwd]
    if (!cwdChanged && current !== undefined && prevCurrent !== current) {
      // Navigating to a conversation (same project): ensure its tab exists
      // and ACTIVATE it — the target conversation's tab is the one the user
      // just switched to, so it must take the highlight (an ordinary tab:
      // clicking a tab selects it).
      const currentId = conversationSurfaceId(current)
      if (!workspaceSlice.open.some(surface => surface.id === currentId)) {
        state.openConversation({
          cwd,
          sessionId: current,
          title: conversationTabTitle(current, cwd, sessionList.byId[current]),
          activate: true,
        })
      } else {
        state.activate(cwd, currentId)
      }
    }
    // Any conversation tab whose session disappeared drops out. Everything
    // else in `open[]` stays exactly as the user left it.
    for (const surface of workspaceSlice.open) {
      if (surface.kind === 'conversation' && !validIds.has(surface.id)) {
        state.close(cwd, surface.id)
      }
    }
    const activeId = workspaceSlice.activeId
    const activeExists = activeId !== null
      && workspaceSlice.open.some(surface => surface.id === activeId)
    if (!activeExists && current !== undefined) {
      state.activate(cwd, conversationSurfaceId(current))
    }
    prevCurrentByCwdRef.current = { ...prevCurrentByCwdRef.current, [cwd]: current }
    prevCwdRef.current = cwd
  }, [conversationTabs, cwd, current, sessionList])

  return (
    <SurfaceTabStrip aria-label={t('center.tablist')}>
      {slice.open.map(surface => {
        const isConversation = surface.kind === 'conversation'
        const summary = isConversation
          ? sessionList.byId[surface.sessionId]
          : undefined
        const label = isConversation
          ? conversationTabTitle(surface.sessionId, surface.cwd, summary)
          : surface.title
        const active = slice.activeId === surface.id
        return (
          <SurfaceTab
            key={surface.id}
            label={label}
            title={isConversation ? surface.sessionId : (surface.kind === 'file' || surface.kind === 'diff' || surface.kind === 'commit-file' ? surface.filePath : surface.title)}
            icon={surfaceIcon(surface)}
            active={active}
            isPreview={!isConversation && surface.kind !== 'terminal' && surface.isPreview}
            closeLabel={t('center.close')}
            onSelect={() => {
              if (isConversation) {
                useCenterSurfaceStore.getState().openConversation({
                  cwd: surface.cwd,
                  sessionId: surface.sessionId,
                  title: conversationTabTitle(surface.sessionId, surface.cwd, summary),
                })
                sessions.open(surface.sessionId)
              } else {
                useCenterSurfaceStore.getState().activate(cwd!, surface.id)
              }
            }}
            {...(!isConversation && surface.kind !== 'terminal' && surface.isPreview
              ? { onPin: () => { useCenterSurfaceStore.getState().pin(cwd!, surface.id) } }
              : {})}
            onClose={() => {
              // Closing ANY tab (conversation included) removes it from the
              // open set — a conversation tab is just a tab: the session
              // itself is untouched and stays in the session list (reopen it
              // from the left rail and the tab returns).
              if (surface.kind === 'terminal' && cwd !== undefined) {
                releaseTerminalInstance({ cwd }, surface.id)
                void sidebarApi.ptyClose({ cwd }, surface.id)
              }
              useCenterSurfaceStore.getState().close(cwd!, surface.id)
            }}
          />
        )
      })}
    </SurfaceTabStrip>
  )
}

/** Empty slice used while no workspace is active. */
const EMPTY_CENTER_SLICE: CenterSurfaceSlice = { open: [], activeId: null }

/**
 * The unified top rail: the center tab strip owns ALL top-of-window
 * controls as in-flow flex members, so nothing floats over the tabs:
 * - LEFT: the left-rail toggle — ALWAYS rendered, the single manager of
 *   the DSH left rail (DSH's own header toggle is hidden by CSS; the
 *   strip's live `is-left-collapsed` padding keeps it exactly right of
 *   the macOS traffic lights in every rail state);
 * - MIDDLE: the tab scroller (the ONLY scrolling member);
 * - RIGHT: the right-rail reopen button (only while the panel is closed —
 *   pinned to the strip's right end, never covered by overflowing tabs).
 * Both buttons keep the same glyph and hover states; their position no
 * longer depends on fixed viewport coordinates or hard-coded offsets.
 */
function LeftRailToggleButton(props: {
  onToggleLeftRail(): void
  /** Whether the DSH left rail is currently expanded (null = unknown). */
  leftRailOpen: boolean | null
}): JSX.Element {
  const label = props.leftRailOpen === true ? '收起左栏' : '展开左栏'
  return (
    <button
      type="button"
      className="oh-dsh-left-rail-toggle"
      aria-label={label}
      title={label}
      aria-pressed={props.leftRailOpen === true}
      onClick={props.onToggleLeftRail}
    >
      <span className="oh-dsh-rail-toggle-glyph" aria-hidden="true">
        <IconSidebarLeftFilled />
      </span>
    </button>
  )
}

function RightRailReopenButton(props: {
  sidebar: DesktopSidebarServiceLike
}): JSX.Element {
  return (
    <button
      type="button"
      className="oh-dsh-right-rail-reopen"
      aria-label="展开右栏"
      title="展开右栏"
      onClick={() => { props.sidebar.setOpen(true) }}
    >
      <span className="oh-dsh-rail-toggle-glyph" aria-hidden="true">
        <IconSidebarRightFilled />
      </span>
    </button>
  )
}

/** Track the DSH left rail open/closed state via its toggle button's
 *  aria-label (flips between 打开侧边栏 / 收起侧边栏). */
function useLeftRailOpenState(): {
  leftRailOpen: boolean | null
  toggleLeftRail(): void
} {
  const [leftRailOpen, setLeftRailOpen] = useState<boolean | null>(null)
  useEffect(() => {
    const read = (): void => {
      const next = readLeftRailOpen()
      if (next !== null) setLeftRailOpen(next)
    }
    read()
    // Observe only the DSH left sidebar subtree (not the whole body):
    // chat streaming re-renders the conversation constantly, and this
    // state only depends on the sidebar toggle's aria-label.
    const observer = new MutationObserver(read)
    const sidebarSlot = document.querySelector<HTMLElement>('[data-slot="sidebar"]')
    const root = sidebarSlot ?? document.body
    if (root !== null) {
      observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'class'] })
    }
    return () => { observer.disconnect() }
  }, [])
  return {
    leftRailOpen,
    toggleLeftRail: () => {
      leftRailToggleButton()?.click()
    },
  }
}

export function CenterSurfaceBody({
  sessions,
  sidebar,
}: {
  sessions: SessionsService
  sidebar: DesktopSidebarServiceLike
}): JSX.Element {
  const sessionList = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  const current = sessionList.current
  const cwd = current === undefined ? undefined : sessionList.byId[current]?.cwd
  const slice = useCenterSurfaceStore(state =>
    cwd === undefined ? EMPTY_CENTER_SLICE : state.getSlice(cwd))
  const active = resolveActiveSurface(slice)
  const hidden = active === null || active.kind === 'conversation'
  let content: ReactNode = null
  if (active !== null && !hidden) {
    content = sidebar.renderSurface(active)
  }
  return (
    <div className="oh-dsh-center-surface-body" data-hidden={hidden || undefined}>
      {content ?? (
        <div className="oh-dsh-center-surface-empty">—</div>
      )}
    </div>
  )
}

/* ---------- mount / unmount ---------- */

export interface CenterSurfaceHostOptions {
  sessions: SessionsService
  t: Translate<WorkspaceMessage>
  /** The desktop sidebar service (right rail + surface renderer registry). */
  sidebar: DesktopSidebarServiceLike
  /** Workspace/session control — the center "+" menu starts new sessions. */
  workspaces: WorkspacesService
}

/** The subset of the sidebar service the center strip drives. */
export interface DesktopSidebarServiceLike {
  getSnapshot(): SidebarSnapshot
  subscribe(listener: () => void): () => void
  setOpen(open: boolean): void
  openTab(seed: SidebarTabSeed): unknown
  renderSurface(surface: CenterSurface): ReactNode
}

/**
 * The center strip's "+" menu: opens browser / terminal / new conversation
 * as first-class surfaces — plain click opens in the CENTER, holding Alt
 * opens in the RIGHT RAIL instead (a new terminal/browser tab there). A
 * new conversation always starts a fresh blank session (the project
 * header's "new chat" behavior), which lives in the center by nature.
 */
function CenterAddMenu({
  sessions,
  sidebar,
  workspaces,
  t,
}: {
  sessions: SessionsService
  sidebar: DesktopSidebarServiceLike
  workspaces: WorkspacesService
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [altDown, setAltDown] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)
  const getAnchorRect = useCallback(
    () => anchorRef.current?.getBoundingClientRect() ?? null,
    [],
  )
  // While the menu is open, track the Alt modifier (Alt+click = right rail);
  // it resets on close / blur so a stale modifier never leaks.
  useEffect(() => {
    if (!open) return
    setAltDown(false)
    const keydown = (event: KeyboardEvent): void => { if (event.key === 'Alt') setAltDown(true) }
    const keyup = (event: KeyboardEvent): void => { if (event.key === 'Alt') setAltDown(false) }
    const clear = (): void => { setAltDown(false) }
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', clear)
    }
  }, [open])
  const sessionList = useSyncExternalStore(sessions.list.subscribe, sessions.list.getSnapshot)
  const currentSessionId = sessionList.current ?? ''
  const cwd = sessionList.current === undefined
    ? undefined
    : sessionList.byId[sessionList.current]?.cwd
  const hasWorkspace = currentSessionId !== '' && typeof cwd === 'string' && cwd.trim() !== ''
  const items: MenuEntry[] = [
    {
      id: 'browser',
      label: t('browser'),
      icon: <IconExternalLink size={14} />,
      disabled: !hasWorkspace,
    },
    {
      id: 'terminal',
      label: t('terminal'),
      icon: <IconTerminal size={14} />,
      disabled: !hasWorkspace,
    },
    { id: 'new-conversation', label: t('add.new-conversation'), icon: <IconPlus size={14} /> },
  ]
  const pick = (id: string): void => {
    setOpen(false)
    if (id === 'browser') {
      if (!hasWorkspace || cwd === undefined) return
      if (altDown) {
        sidebar.openTab({ type: 'browser' })
        sidebar.setOpen(true)
        return
      }
      useCenterSurfaceStore.getState().openBrowser({ cwd, title: t('browser'), preview: false })
      return
    }
    if (id === 'terminal') {
      if (!hasWorkspace || cwd === undefined) return
      if (altDown) {
        sidebar.openTab({ type: 'terminal' })
        sidebar.setOpen(true)
        return
      }
      const scope = { cwd }
      if (!canOpenTerminalInstance(scope)) return
      const surface = useCenterSurfaceStore.getState().openTerminal({ cwd, title: t('terminal') })
      touchTerminalInstance(scope, surface.id)
      return
    }
    // New conversation: a fresh blank session in the center (same as the
    // project header's "new chat"); a session always lives in the center,
    // so the Alt/right-rail variant is identical.
    workspaces.startSession()
  }
  return (
    <div className="oh-dsh-center-add">
      <button
        ref={anchorRef}
        type="button"
        aria-label={t('add.open')}
        aria-expanded={open}
        title={t('add.open')}
        onClick={() => { setOpen(value => !value) }}
      ><IconPlus size={14} /></button>
      <Menu
        open={open}
        anchor={null}
        align="end"
        items={items}
        portal
        getAnchorRect={getAnchorRect}
        onSelect={pick}
        onClose={() => { setOpen(false) }}
      />
    </div>
  )
}

export class CenterSurfaceHost {
  private readonly sessions: SessionsService
  private readonly t: Translate<WorkspaceMessage>
  private readonly sidebar: DesktopSidebarServiceLike
  private readonly workspaces: WorkspacesService
  private root: Root | null = null
  private element: HTMLDivElement | null = null
  private attachObserver: MutationObserver | null = null
  private stopPersist: (() => void) | null = null
  private remountVersion = 0

  constructor(options: CenterSurfaceHostOptions) {
    this.sessions = options.sessions
    this.t = options.t
    this.sidebar = options.sidebar
    this.workspaces = options.workspaces
  }

  mount(): void {
    if (this.element !== null) return
    this.element = document.createElement('div')
    this.element.id = 'oh-dsh-center-tabs-root'
    this.root = createRoot(this.element)
    this.render()
    this.stopPersist = persistCenterSurfaces()
    restoreCenterSurfaces()
    this.attachToCenterColumn()
  }

  dispose(): void {
    this.attachObserver?.disconnect()
    this.attachObserver = null
    this.stopPersist?.()
    this.stopPersist = null
    this.root?.unmount()
    this.root = null
    this.element?.remove()
    this.element = null
    useCenterSurfaceStore.getState().clearAll()
  }

  private render(): void {
    // key forces a fresh mount when the version bumps (self-healing after
    // the DSH tree rebuilds and discards our subtree).
    this.root?.render(
      <CenterSurfaceHostView
        key={this.remountVersion}
        sessions={this.sessions}
        t={this.t}
        sidebar={this.sidebar}
        workspaces={this.workspaces}
      />,
    )
  }

  /**
   * Mount the tab strip inside the DSH center column as a normal-flow flex
   * child (`.aOBRAa_centerCol` is a `flex-direction: column` container whose
   * only child is the `[data-slot="conversation"]` slot — we prepend next to
   * it, above the conversation, instead of overlaying the whole center area
   * with a fixed element).
   *
   * Normal flow removes every overlay problem: the strip never needs to
   * track the left-rail width (the column already sits between the rails),
   * a floating tooltip can no longer push it, and an active surface body
   * occupies the column in-flow (pushing the conversation out of view)
   * instead of painting on top of it.
   *
   * The DSH layout mounts asynchronously and re-renders its tree, so a
   * MutationObserver re-attaches the node if it is ever missing. If the DSH
   * tree crashes and rebuilds, our element survives the re-attach but its
   * React-rendered children are gone — an emptied element triggers a forced
   * remount so the host recovers without a reload.
   */
  private attachToCenterColumn(): void {
    const attach = (): boolean => {
      if (this.element === null) return false
      const column = centerColumnElement()
      if (column === null) return false
      if (this.element.parentElement === column) {
        if (this.element.childElementCount === 0) {
          this.remountVersion += 1
          this.render()
        }
        return true
      }
      column.prepend(this.element)
      return true
    }
    if (attach()) return
    this.attachObserver = new MutationObserver(() => { attach() })
    if (document.body !== null) {
      this.attachObserver.observe(document.body, {
        childList: true,
        subtree: true,
      })
    }
  }
}

/**
 * A render crash in one surface must not take the whole center host (and
 * its tabs) down: the boundary shows a retryable error instead.
 */
class CenterSurfaceHostErrorBoundary extends Component<
  { children: ReactNode; t: Translate<WorkspaceMessage> },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[sidebar] center surface host crashed', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error === null) return this.props.children
    return (
      <div className="oh-dsh-center-host-crash">
        <ErrorView
          message={this.props.t('center.crash')}
          retryLabel={this.props.t('overlay.retry')}
          onRetry={() => { this.setState({ error: null }) }}
        />
      </div>
    )
  }
}

function CenterSurfaceHostView({
  sessions,
  t,
  sidebar,
  workspaces,
}: {
  sessions: SessionsService
  t: Translate<WorkspaceMessage>
  sidebar: DesktopSidebarServiceLike
  workspaces: WorkspacesService
}): JSX.Element {
  const [mounted, setMounted] = useState(false)
  const { leftRailOpen, toggleLeftRail } = useLeftRailOpenState()
  const rightOpen = useSyncExternalStore(
    useCallback((listener: () => void) => sidebar.subscribe(listener), [sidebar]),
    () => sidebar.getSnapshot().open,
  )
  useEffect(() => { setMounted(true) }, [])
  useCenterColumnHeight()
  // A real placeholder keeps the host root non-empty while mounting: the
  // self-healing attach logic treats an EMPTIED root as "DSH rebuilt its
  // tree and discarded our children" and force-remounts.
  if (!mounted) return <span className="oh-dsh-center-host-mounting" aria-hidden="true" />
  return (
    <CenterSurfaceHostErrorBoundary t={t}>
      <DiffWorkerPoolProvider>
        <DiffThemeSync />
        {/* The unified top rail: left toggle + tab scroller + right reopen,
            all in-flow members of the strip (see the TopRailControls
            section comment above). */}
        <div
          className={`oh-dsh-center-tabs-strip${leftRailOpen === false ? ' is-left-collapsed' : ''}${rightOpen ? '' : ' is-right-free'}`}
        >
          <LeftRailToggleButton onToggleLeftRail={toggleLeftRail} leftRailOpen={leftRailOpen} />
          <div className="oh-dsh-center-tabs-scroller">
            <CenterSurfaceTabs sessions={sessions} t={t} />
          </div>
          <CenterAddMenu sessions={sessions} sidebar={sidebar} workspaces={workspaces} t={t} />
          {!rightOpen && <RightRailReopenButton sidebar={sidebar} />}
        </div>
        <CenterSurfaceBody sessions={sessions} sidebar={sidebar} />
      </DiffWorkerPoolProvider>
    </CenterSurfaceHostErrorBoundary>
  )
}

/**
 * Keep `--oh-dsh-center-col-height` on the tabs root in sync with the DSH
 * center column's real height (grid-stretched, not expressible as 100%):
 * the surface body fills the column exactly — never drifting off the top
 * (strip scrolled away) or overflowing past the bottom (conversation
 * leaking below the body).
 */
function useCenterColumnHeight(): void {
  useEffect(() => {
    const rootElement = document.getElementById('oh-dsh-center-tabs-root')
    if (rootElement === null) return
    let lastHeight = -1
    const apply = (): void => {
      const column = centerColumnElement()
      if (column === null) return
      const next = column.clientHeight
      // Dirty-checked: the observer fires on any width change (e.g. dragging
      // the sidebar), but the column height is unaffected; only write the
      // variable when the height actually changes, avoiding an element
      // style write that cascades layout to children.
      if (next === lastHeight) return
      lastHeight = next
      rootElement.style.setProperty('--oh-dsh-center-col-height', `${String(next)}px`)
    }
    apply()
    let observer: ResizeObserver | null = null
    const column = centerColumnElement()
    if (column !== null) {
      observer = new ResizeObserver(apply)
      observer.observe(column)
    }
    // The DSH layout mounts asynchronously; watch until the column exists.
    const attachObserver = new MutationObserver(() => {
      if (observer === null) {
        const next = centerColumnElement()
        if (next === null) return
        apply()
        observer = new ResizeObserver(apply)
        observer.observe(next)
        attachObserver.disconnect()
      }
    })
    if (document.body !== null) {
      attachObserver.observe(document.body, { childList: true, subtree: true })
    }
    return () => {
      observer?.disconnect()
      attachObserver.disconnect()
    }
  }, [])
}

// Re-exported for callers that need the store actions directly.
export { useCenterSurfaceStore }
export type { CenterSurface }
export { persistCenterSurfaces, restoreCenterSurfaces } from './center-surface-store.ts'

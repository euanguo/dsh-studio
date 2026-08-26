/**
 * Center surface host: the middle-area tab strip + active surface body.
 *
 * Mounts a fixed overlay (`#dsh-studio-center-tabs-root`) spanning the center
 * column — between the DSH left sidebar (measured) and the desktop right
 * panel. Conversation tabs come from the sessions service (the current
 * project's sessions); file/diff/browser surfaces open as preview tabs
 * (single click replaces, double click pins).
 *
 * When a conversation tab is active the body is hidden so the DSH
 * conversation is visible; any other surface kind renders its body over
 * the center column.
 */
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import { Component, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { LayoutService } from '@dsh-studio/shared/workbench-contracts'
import { ensureLayoutDom } from '@dsh-studio/shared/layout-dom'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconSidebarRightFilled } from '@dsh-studio/shared/tabler-icons'
import type { WorkspaceMessage } from '../i18n.ts'
import { EmptyState, ErrorState, ToolbarAction } from '@dsh-studio/shared/ui'
import { centerColumnElement } from './dsh-dom.ts'
import { LeftRailToggle, useLeftRailOpenState } from '../side-rail-toggle.tsx'
import { createOverlayArbiter, OverlayArbiterProvider } from '../selection/overlay-arbiter.tsx'
import type { SessionsService, WorkspacesService } from '../client-types.ts'
import type { SidebarSnapshot, SidebarTabSeed } from '../contract.ts'
import {
  persistCenterSurfaces,
  restoreCenterSurfaces,
  useCenterSurfaceStore,
} from './center-surface-store.ts'
import { resolveActiveSurface, type CenterSurface } from './types.ts'
import { resolveCenterWorkspace } from './center-surface-sync.ts'
import {
  DiffThemeSync,
  DiffWorkerPoolProvider,
} from '../diff/pierre-adapter.tsx'
import { CenterAddMenu } from './center-surface-add-menu.tsx'
import { CenterSurfaceTabs } from './center-surface-tabs.tsx'
import { EMPTY_CENTER_SLICE } from './center-surface-meta.tsx'

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
function RightRailReopenButton(props: {
  sidebar: DesktopSidebarServiceLike
}): JSX.Element {
  return (
    <ToolbarAction
      variant="ghost"
      className={surfaceCss["dsh-studio-right-rail-reopen"]}
      icon={(
        <span className={surfaceCss["dsh-studio-rail-toggle-glyph"]} aria-hidden="true">
          <IconSidebarRightFilled />
        </span>
      )}
      label="展开右栏"
      onClick={() => { props.sidebar.setOpen(true) }}
    />
  )
}

export function CenterSurfaceBody({
  sessions,
  sidebar,
}: {
  sessions: SessionsService
  sidebar: DesktopSidebarServiceLike
}): JSX.Element {
  // Identity reactivity rides the runtime's current-session projection
  // (leaf-1.7); the roster itself is read fresh at render.
  useSyncExternalStore(sessions.currentProvideInfo.subscribe, sessions.currentProvideInfo.getSnapshot)
  const sessionList = sessions.list.getSnapshot()
  const workspace = resolveCenterWorkspace(sessionList)
  const cwd = workspace.status === 'ready' ? workspace.cwd : undefined
  const slice = useCenterSurfaceStore(state =>
    cwd === undefined ? EMPTY_CENTER_SLICE : state.getSlice(cwd))
  const active = resolveActiveSurface(slice)
  const hidden = active === null || active.kind === 'conversation'
  let content: ReactNode = null
  if (active !== null && !hidden) {
    content = sidebar.renderSurface(active)
  }
  // Each center surface gets its OWN overlay arbiter (C16): the conversation
  // picker and comment rails on this surface share the lock, while switching
  // to a different surface cannot deadlock a previous one. The instance is
  // memoized on the surface identity so re-renders don't drop the lock.
  const arbiter = useMemo(() => createOverlayArbiter(), [active])
  return (
    <div className={surfaceCss["dsh-studio-center-surface-body"]} data-hidden={hidden || undefined}>
      <OverlayArbiterProvider arbiter={arbiter}>
        {content ?? (
          <EmptyState layout="centered" className={surfaceCss["dsh-studio-center-surface-empty"]} title="—" />
        )}
      </OverlayArbiterProvider>
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
  /** The workbench kernel layout service (center-tabs region claimant). */
  layout: LayoutService
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

export class CenterSurfaceHost {
  private readonly sessions: SessionsService
  private readonly t: Translate<WorkspaceMessage>
  private readonly sidebar: DesktopSidebarServiceLike
  private readonly workspaces: WorkspacesService
  // The center-tabs region claim + the document-style channel for the
  // column-height variable (single write point).
  private readonly dom: ReturnType<typeof ensureLayoutDom>
  private centerClaim: { release(): void } | null = null
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
    this.dom = ensureLayoutDom(options.layout)
  }

  mount(): void {
    if (this.element !== null) return
    this.centerClaim = this.dom.layout.claim('center-tabs', 'center-surfaces')
    this.element = document.createElement('div')
    this.element.id = 'dsh-studio-center-tabs-root'
    this.root = createRoot(this.element)
    this.render()
    this.stopPersist = persistCenterSurfaces()
    void restoreCenterSurfaces()
    this.attachToCenterColumn()
  }

  dispose(): void {
    this.attachObserver?.disconnect()
    this.attachObserver = null
    this.stopPersist?.()
    this.stopPersist = null
    this.centerClaim?.release()
    this.centerClaim = null
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
        dom={this.dom}
      />,
    )
  }

  /**
   * Mount the tab strip inside the DSH center column as a normal-flow flex
   * child (`.aOBRAa_centerCol` is a `flex-direction: column` container whose
   * only child is the DSH conversation slot located by dsh-dom.ts
   * `centerColumnElement()` — we prepend next to it, above the conversation,
   * instead of overlaying the whole center area with a fixed element).
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
      <div className={surfaceCss["dsh-studio-center-host-crash"]}>
        <ErrorState
          message={this.props.t('center.crash')}
          action={(
            <Button variant="outline" size="sm" onClick={() => { this.setState({ error: null }) }}>
              {this.props.t('overlay.retry')}
            </Button>
          )}
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
  dom,
}: {
  sessions: SessionsService
  t: Translate<WorkspaceMessage>
  sidebar: DesktopSidebarServiceLike
  workspaces: WorkspacesService
  dom: ReturnType<typeof ensureLayoutDom>
}): JSX.Element {
  const [mounted, setMounted] = useState(false)
  const { leftRailOpen, toggleLeftRail } = useLeftRailOpenState()
  const rightOpen = useSyncExternalStore(
    useCallback((listener: () => void) => sidebar.subscribe(listener), [sidebar]),
    () => sidebar.getSnapshot().open,
  )
  useEffect(() => { setMounted(true) }, [])
  useCenterColumnHeight(dom)
  // A real placeholder keeps the host root non-empty while mounting: the
  // self-healing attach logic treats an EMPTIED root as "DSH rebuilt its
  // tree and discarded our children" and force-remounts.
  if (!mounted) return <span className={surfaceCss["dsh-studio-center-host-mounting"]} aria-hidden="true" />
  return (
    <CenterSurfaceHostErrorBoundary t={t}>
      <DiffWorkerPoolProvider>
        <DiffThemeSync />
        {/* The unified top rail: left toggle + tab scroller + right reopen,
            all in-flow members of the strip (see the TopRailControls
            section comment above). */}
        <div
          className={`${surfaceCss["dsh-studio-center-tabs-strip"]}${leftRailOpen === false ? ' is-left-collapsed' : ''}${rightOpen ? '' : ' is-right-free'}`}
        >
          <LeftRailToggle onToggle={toggleLeftRail} open={leftRailOpen} />
          <div className={surfaceCss["dsh-studio-center-tabs-scroller"]}>
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
 * Keep the center column's real height published through the region host's
 * document-style channel (`--dsh-studio-center-col-height`, grid-stretched, not expressible as 100%):
 * the surface body fills the column exactly — never drifting off the top
 * (strip scrolled away) or overflowing past the bottom (conversation
 * leaking below the body).
 */
function useCenterColumnHeight(dom: ReturnType<typeof ensureLayoutDom>): void {
  useEffect(() => {
    // The tabs root must exist before the height channel starts publishing.
    if (document.getElementById('dsh-studio-center-tabs-root') === null) return
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
      dom.applyDocumentStyles({
        vars: { '--dsh-studio-center-col-height': `${String(next)}px` },
      })
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

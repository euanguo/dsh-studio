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
import { Component, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Translate } from '@dsh-studio/shared/i18n'
import {
  Button,
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
} from '@dsh-studio/shared/tabler-icons'
import type { WorkspaceMessage } from '../i18n.ts'
import { EmptyState, ErrorState, ToolbarAction, useMenuAnchor } from '@dsh-studio/shared/ui'
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
  currentConversationSyncAction,
  resolveCenterWorkspace,
  retainConversationSurface,
  type CenterWorkspace,
} from './center-surface-sync.ts'
import {
  SurfaceTab,
  SurfaceTabStrip,
} from '@dsh-studio/shared/ui'
import {
  useTabStripDrag,
} from '../use-tab-strip-drag.ts'
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
function LeftRailToggleButton(props: {
  onToggleLeftRail(): void
  /** Whether the DSH left rail is currently expanded (null = unknown). */
  leftRailOpen: boolean | null
}): JSX.Element {
  const label = props.leftRailOpen === true ? '收起左栏' : '展开左栏'
  return (
    <ToolbarAction
      variant="ghost"
      className={surfaceCss["dsh-studio-left-rail-toggle"]}
      icon={(
        <span className={surfaceCss["dsh-studio-rail-toggle-glyph"]} aria-hidden="true">
          <IconSidebarLeftFilled />
        </span>
      )}
      label={label}
      pressed={props.leftRailOpen === true}
      onClick={props.onToggleLeftRail}
    />
  )
}

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
  return (
    <div className={surfaceCss["dsh-studio-center-surface-body"]} data-hidden={hidden || undefined}>
      {content ?? (
        <EmptyState layout="centered" className={surfaceCss["dsh-studio-center-surface-empty"]} title="—" />
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
    this.element.id = 'dsh-studio-center-tabs-root'
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
          <LeftRailToggleButton onToggleLeftRail={toggleLeftRail} leftRailOpen={leftRailOpen} />
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
 * Keep `--dsh-studio-center-col-height` on the tabs root in sync with the DSH
 * center column's real height (grid-stretched, not expressible as 100%):
 * the surface body fills the column exactly — never drifting off the top
 * (strip scrolled away) or overflowing past the bottom (conversation
 * leaking below the body).
 */
function useCenterColumnHeight(): void {
  useEffect(() => {
    const rootElement = document.getElementById('dsh-studio-center-tabs-root')
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
      rootElement.style.setProperty('--dsh-studio-center-col-height', `${String(next)}px`)
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

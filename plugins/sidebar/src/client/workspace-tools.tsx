/**
 * The workspace-tools service: the panel-level orchestration behind the
 * sidebar (open/toggle/maximize, review/browser/files/side-chat/trajectory
 * entry points, keymap actions, layout squeeze). Extracted from the former
 * single-file plugin assembly so the built-in tab registrations can depend
 * on it without a plugin.tsx import cycle.
 */
import {
  useMemo,
  useSyncExternalStore,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PinnedSummary } from '@dsh-studio/pinned-summary/client'
import { basename } from '@dsh-studio/shared/path'
import type { LocaleService, Translate } from '@dsh-studio/shared/i18n'
import { useTranslate } from '@dsh-studio/shared/use-i18n'
import { ensureStyle } from '@dsh-studio/shared/style-injector'
import { ensureLayoutDom } from '@dsh-studio/shared/layout-dom'
import type { LayoutService } from '@dsh-studio/shared/workbench-contracts'
import { ToastHost } from '@dsh-studio/shared/toast'
import { DialogHost } from './kit/dialog.tsx'
import { SideToolsPanel } from './SideToolsPanel.tsx'
import { createOverlayArbiter, OverlayArbiterProvider } from './selection/overlay-arbiter.tsx'
import type { WorkspaceMessage } from './i18n.ts'
import type { DesktopSidebarService } from './contract.ts'
import {
  binding,
  installKeymap,
  registerKeymapAction,
} from './kit/keymap.ts'
import type {
  SessionsService,
  WorkspaceTools,
  WorkspaceToolsState,
  WorkspacesService,
} from './client-types.ts'
import { applyChromeGeometry } from './chrome-geometry.ts'
import {
  leftSidebarColumnElement,
  observeLeftSidebarColumnResize,
  trajectoryTabButton,
} from './surfaces/dsh-dom.ts'
import {
  clampSidebarWidth,
  maximizedSidebarWidth,
  SIDEBAR_COLLAPSE_THRESHOLD_PX,
} from '../sidebar-preferences.ts'
import { ensureSharedUiStyles } from '@dsh-studio/shared/ui'
import { pluginCss as sidebarSurfaceCss } from './styles.js'
import terminalViewCss from '@dsh-studio/shared/terminal-view.css'
import xtermCss from '@xterm/xterm/css/xterm.css'

export class WorkspaceToolsService implements WorkspaceTools {
  private stopSharedStyle: (() => void) | undefined
  private stopStyle: (() => void) | undefined
  private element: HTMLDivElement | undefined
  private root: Root | undefined
  // Overlay-region handles for the body-level surfaces this service mounts.
  private sidebarOverlay: (() => void) | undefined
  private toastOverlay: (() => void) | undefined
  // The toast host mounts on its own document.body element (the sidebar
  // root is a clipped fixed overlay that only spans the panel footprint,
  // so an in-panel host would hide or misplace toasts).
  private toastElement: HTMLDivElement | undefined
  private toastRoot: Root | undefined
  private stopSidebar: (() => void) | undefined
  /**
   * Drag session guard. A pointer drag is one atomic geometry transaction:
   * while true, store subscriptions skip intermediate layout writes;
   * {@link commitResizeWidth} publishes the final width and applies it once
   * at the end.
   */
  private resizing = false
  private stopKeymap: (() => void) | undefined
  private stopChromeGeometry: (() => void) | undefined
  private stopMaximizedGeometry: (() => void) | undefined
  private readonly disposeKeymapActions: Array<() => void> = []
  // The LayoutService region host: the single DOM write point for the
  // right-panel reservation and document-level chrome flags.
  private readonly dom: ReturnType<typeof ensureLayoutDom>

  constructor(
    readonly sidebar: DesktopSidebarService,
    /** The workbench kernel layout service (`ctx.get('workbench.layout')`). */
    layout: LayoutService,
    private readonly locale: LocaleService,
    private readonly t: Translate<WorkspaceMessage>,
    private readonly pinnedSummary: PinnedSummary,
    private readonly sessions: SessionsService,
    private readonly workspaces: WorkspacesService,
  ) {
    this.dom = ensureLayoutDom(layout)
  }

  /** Live read of the panel geometry straight from the sidebar snapshot.
   *  Only used by imperative methods; React surfaces derive their own memo.
   */
  private get panel(): WorkspaceToolsState {
    const snapshot = this.sidebar.getSnapshot()
    const active = snapshot.tabs.find(tab => tab.id === snapshot.activeId)
    return {
      maximized: snapshot.maximized,
      open: snapshot.open,
      view: active?.type ?? 'menu',
      width: snapshot.width,
    }
  }

  /** A3: the ONE place encoding the right-panel ↔ pinned-summary mutual
   *  exclusion — opening or widening the side panel collapses the pinned
   *  summary card (and vice versa, enforced by the summary's own claim).
   *  Every panel-opening entry point funnels through here so the policy has
   *  exactly one home instead of being re-stated at each call site.
   */
  private claimPanelExclusivity(): void {
    this.pinnedSummary.setOpen(false)
  }

  isOpen(): boolean { return this.sidebar.getSnapshot().open }

  setOpen(open: boolean): void {
    if (open) this.claimPanelExclusivity()
    this.sidebar.setOpen(open)
    // The snapshot observer re-applies the flag; clear eagerly on close so
    // the document never keeps a stale maximize marker.
    if (!open) this.applyMaximizedFlag(null)
  }

  toggle(): void {
    const panel = this.panel
    if (panel.open && panel.view === 'review') this.setOpen(false)
    else this.openReview()
  }

  openReview(): void { this.openView('review') }

  openBrowser(): void { this.openView('browser') }

  openBrowserUrl(url: string): void {
    let title = url
    try {
      title = new URL(url).hostname || url
    } catch {
      // Non-URL resource labels (plain names) keep the raw string as title.
    }
    this.claimPanelExclusivity()
    this.sidebar.openTab({ resource: url, title, type: 'browser' })
    this.sidebar.setOpen(true)
  }

  openFile(path: string): void {
    const title = basename(path)
    this.claimPanelExclusivity()
    this.sidebar.openTab({ resource: path, title, type: 'file' })
    this.sidebar.setOpen(true)
  }

  openFiles(): void {
    const cwd = activeWorkspace(this.sessions)
    if (cwd === undefined || cwd === '') {
      // No workspace to browse: open the panel so the disabled files/Git
      // entries (with their hints) are visible, instead of a silent no-op
      // or an empty file body.
      this.setOpen(true)
      return
    }
    this.openView('files', cwd)
  }

  /**
   * The DEFAULT view when the panel is opened with nothing active: a project
   * with a workspace cwd lands on the file list; without a cwd it stays on
   * the launcher (SideMenu), whose workspace-bound entries show why they are
   * disabled. Only applies when the project has no persisted active tab — a
   * user's chosen tab (after reload) is never clobbered.
   */
  private openDefaultView(): void {
    if (this.sidebar.getSnapshot().activeId !== null) return
    const cwd = activeWorkspace(this.sessions)
    if (cwd === undefined || cwd === '') return
    this.openView('files', cwd)
  }

  openMenu(): void {
    this.claimPanelExclusivity()
    this.sidebar.activateTab(null)
    this.sidebar.setOpen(true)
  }

  toggleSidePanel(): void {
    if (this.panel.open) this.setOpen(false)
    else {
      // Open from closed: start from the launcher, then apply the DEFAULT
      // view — a project with a workspace cwd lands on the file list, one
      // without stays on the launcher (SideMenu) with its disabled hints.
      this.openMenu()
      this.openDefaultView()
    }
  }

  async openSideChat(): Promise<void> {
    const current = this.sessions.list.getSnapshot().current
    if (current === undefined) this.workspaces.startSession()
    else {
      const child = await this.sessions.fork({ sessionId: current, increaseTitle: true })
      this.sessions.open(child)
    }
    this.setOpen(false)
  }

  openTrajectory(): void {
    // The probe lives in dsh-dom.ts (the single upstream-DOM module); the
    // candidates are the translated label plus upstream's known spellings.
    const tab = trajectoryTabButton([this.t('trajectory'), 'trajectory', '轨迹'])
    if (tab === null) return
    tab.click()
    this.setOpen(false)
  }

  togglePanelMaximized(): void {
    const panel = this.panel
    if (!panel.open) return
    const maximized = !panel.maximized
    this.sidebar.setMaximized(maximized)
    this.applyMaximizedFlag(maximized)
  }

  /** The maximize marker is written through the region host's document
   *  style channel (the single documentElement write point). */
  private applyMaximizedFlag(value: boolean | null): void {
    this.dom.applyDocumentStyles({
      flags: { dshStudioPanelMaximized: value === null ? null : 'true' },
    })
  }

  setWidth(width: number): void {
    // The service applies the live viewport cap itself.
    this.sidebar.setWidth(width)
  }

  /**
   * Live drag preview (pointermove hot path). The width is written straight
   * to the DOM (CSS variable + overlay size + the right-panel reservation)
   * without touching the sidebar store, React state or persistence — so a
   * frame of pointermove never commits a React tree, a persistence write,
   * or a theme observer hit. The reservation goes through the LayoutService
   * preview path: it participates in negotiation immediately but the
   * committed claim is re-asserted by {@link commitResizeWidth} on pointerup.
   */
  previewResizeWidth(rawWidth: number): void {
    const panel = this.panel
    if (rawWidth < SIDEBAR_COLLAPSE_THRESHOLD_PX) {
      this.dom.applyDocumentStyles({ vars: { '--dsh-studio-sidebar-width': '0px' } })
      if (this.element !== undefined) this.element.style.width = '0px'
      if (panel.open) this.dom.previewPanel('sidebar', 0)
      return
    }
    const effectiveWidth = clampSidebarWidth(rawWidth, window.innerWidth)
    this.dom.applyDocumentStyles({ vars: { '--dsh-studio-sidebar-width': `${String(effectiveWidth)}px` } })
    if (this.element !== undefined) {
      this.element.style.width = panel.open ? `${String(effectiveWidth)}px` : '0px'
    }
    if (panel.open) {
      // Mirror what the committed claim will produce once the drag settles.
      // While the panel is dragged the sidebar is the only right-panel
      // claimant moving; commitResizeWidth re-asserts the claim.
      this.dom.previewPanel('sidebar', effectiveWidth)
    }
  }

  /**
   * End of a live right-panel drag. The drag is a single atomic geometry
   * session: store subscriptions are suppressed while the width publishes,
   * avoiding intermediate paints, then the final layout is applied once.
   * Dropping below the collapse threshold closes the panel instead.
   */
  commitResizeWidth(rawWidth: number): void {
    if (rawWidth < SIDEBAR_COLLAPSE_THRESHOLD_PX) {
      this.setOpen(false)
      return
    }
    this.resizing = true
    const width = clampSidebarWidth(rawWidth, window.innerWidth)
    if (width !== this.panel.width) this.sidebar.setWidth(width)
    this.resizing = false
    // The final publish (or the unchanged-width path) is applied once here;
    // the pending preview footprint is replaced by the committed claim.
    this.applyLayout()
  }

  /**
   * Maximize keeps the left rail as the fixed boundary of the overlay. The
   * probe owns ResizeObserver reattachment when upstream replaces the rail;
   * this service only reapplies its domain geometry while maximized.
   */
  private observeMaximizedGeometry(): () => void {
    const refresh = (): void => {
      if (this.panel.maximized) this.applyLayout()
    }
    window.addEventListener('resize', refresh)
    const stopLeftRail = observeLeftSidebarColumnResize(refresh)
    return () => {
      window.removeEventListener('resize', refresh)
      stopLeftRail()
    }
  }

  private maximizedPanelWidth(): number {
    const leftColumn = leftSidebarColumnElement()
    return maximizedSidebarWidth(
      window.innerWidth,
      leftColumn?.getBoundingClientRect().width ?? 0,
    )
  }

  mount(): void {
    if (this.panel.open) this.claimPanelExclusivity()
    this.stopSidebar = this.sidebar.subscribe(() => { this.onSidebarChanged() })
    this.stopSharedStyle = ensureSharedUiStyles('dsh-studio-sidebar-shared-ui')
    this.stopStyle = ensureStyle('dsh-studio-sidebar', [
      xtermCss,
      terminalViewCss,
      // The scoped surface stylesheet (styles.ts) carries every sidebar
      // rule; shared/global classes are :global escapes inside it.
      sidebarSurfaceCss,
    ].join('\n'))
    this.element = document.createElement('div')
    this.element.id = 'dsh-studio-sidebar-root'
    // The sidebar is a fixed overlay; the app's center column is squeezed
    // through the LayoutService right-panel claim (applyLayout), never by
    // DOM restructuring. Body-level mounting goes through the overlay
    // region protocol; its stacking stays pinned below upstream dialogs
    // (the stylesheet keeps z-index: 10 for the same reason).
    this.sidebarOverlay = this.dom.mountOverlay('sidebar', this.element, { zIndex: 10 }).release
    this.root = createRoot(this.element)
    this.root.render(
      <WorkspaceToolsSurface
        locale={this.locale}
        t={this.t}
        service={this}
        sessions={this.sessions}
        workspaces={this.workspaces}
        sidebar={this.sidebar}
      />,
    )
    this.toastElement = document.createElement('div')
    this.toastElement.id = 'dsh-studio-toast-root'
    this.toastOverlay = this.dom.mountOverlay('toast-host', this.toastElement).release
    this.toastRoot = createRoot(this.toastElement)
    this.toastRoot.render(
      <>
        <ToastHost />
        <DialogHost />
      </>,
    )
    this.stopKeymap = installKeymap()
    // Window-chrome geometry (traffic lights / Windows overlay caption) →
    // the top rail's left/right reservation CSS variables.
    this.stopChromeGeometry = applyChromeGeometry()
    this.stopMaximizedGeometry = this.observeMaximizedGeometry()
    // Global (panel-level) shortcuts: registered for the app lifetime.
    // Surface-scoped shortcuts register from their mounted views.
    this.disposeKeymapActions.push(
      registerKeymapAction('panel.toggle', binding({ mod: true, alt: true, key: 'b' }), () => {
        this.toggleSidePanel()
        return true
      }),
      registerKeymapAction('panel.maximizeEscape', binding({ key: 'Escape' }), () => {
        if (!this.panel.maximized) return false
        this.togglePanelMaximized()
        return true
      }),
      registerKeymapAction('review.open', binding({ ctrl: true, shift: true, key: 'g' }), () => {
        this.openReview()
        return true
      }),
      registerKeymapAction('browser.open', binding({ mod: true, key: 't' }), () => {
        this.openBrowser()
        return true
      }),
      registerKeymapAction('files.open', binding({ mod: true, key: 'p' }), () => {
        this.openFiles()
        return true
      }),
      registerKeymapAction('sidechat.open', binding({ mod: true, alt: true, key: 's' }), () => {
        void this.openSideChat()
        return true
      }),
    )
    this.applyLayout()
  }

  dispose(): void {
    this.stopSidebar?.()
    for (const unregister of this.disposeKeymapActions) unregister()
    this.disposeKeymapActions.length = 0
    this.stopKeymap?.()
    this.stopKeymap = undefined
    this.stopChromeGeometry?.()
    this.stopChromeGeometry = undefined
    this.stopMaximizedGeometry?.()
    this.stopMaximizedGeometry = undefined
    this.root?.unmount()
    this.toastRoot?.unmount()
    // Overlay releases remove the body-level elements and drop their claims.
    this.sidebarOverlay?.()
    this.sidebarOverlay = undefined
    this.toastOverlay?.()
    this.toastOverlay = undefined
    this.element = undefined
    this.toastElement = undefined
    this.stopSharedStyle?.()
    this.stopSharedStyle = undefined
    this.stopStyle?.()
    this.stopStyle = undefined
    // Clear every document-level marker this service owned.
    this.dom.applyDocumentStyles({
      vars: { '--dsh-studio-sidebar-width': null },
      flags: {
        dshStudioDesktopSidebarOpen: null,
        dshStudioPanelMaximized: null,
        dshStudioRightPanelWidth: null,
      },
    })
    this.dom.releasePanel('sidebar')
  }

  private openView(view: string, resource?: string): void {
    this.claimPanelExclusivity()
    this.sidebar.openTab({
      type: view,
      ...(resource !== undefined ? { resource } : {}),
    })
    this.sidebar.setOpen(true)
  }

  /** Re-sync the DOM footprint whenever the sidebar snapshot changes (the
   *  service's only subscription; the projection store it used to maintain
   *  is gone — React surfaces read the sidebar snapshot directly). Intermediate
   *  publishes inside one drag session are suppressed — the drag commits the
   *  final geometry once (see {@link commitResizeWidth}). */
  private onSidebarChanged(): void {
    if (this.resizing) return
    const panel = this.panel
    if (panel.open) this.claimPanelExclusivity()
    this.applyMaximizedFlag(panel.open && panel.maximized ? true : null)
    this.applyLayout()
  }

  private applyLayout(): void {
    const panel = this.panel
    const fullWidth = panel.open && panel.maximized
    const effectiveWidth = fullWidth ? this.maximizedPanelWidth() : panel.width
    const widthCss = `${String(effectiveWidth)}px`
    const overlayWidth = panel.open ? widthCss : '0px'

    // All document-level markers go through the region host's single write
    // point; the values themselves stay sidebar-domain decisions.
    this.dom.applyDocumentStyles({
      vars: { '--dsh-studio-sidebar-width': widthCss },
      flags: {
        dshStudioDesktopSidebarOpen: panel.open ? 'true' : null,
        dshStudioRightPanelWidth: panel.open
          // Publish the resolved footprint so the DSH AppFrame patch can
          // include the plugin rail in its viewport-budget calculation.
          ? String(effectiveWidth)
          : null,
      },
    })
    if (panel.open) {
      // Reserve only the space to the right of the measured left rail when
      // maximized; the fixed overlay still ends at the window's right edge.
      this.dom.reservePanel('sidebar', effectiveWidth)
    } else {
      this.dom.releasePanel('sidebar')
    }
    // The overlay container only occupies the panel footprint while open on
    // wide viewports; closed it collapses to 0 so it never intercepts
    // pointer events over the app (pointer-events: none is defense-in-depth).
    if (this.element !== undefined && this.element.style.width !== overlayWidth) {
      this.element.style.width = overlayWidth
    }
  }
}

/** The ONE cwd derivation for the panel: the current session's workspace
 *  root, or the first non-blank workspace when none is active. Used by the
 *  surface and the open/entry helpers (single source, no inline copies). */
export function activeWorkspace(sessions: SessionsService): string | undefined {
  const snapshot = sessions.list.getSnapshot()
  const current = snapshot.current
  const currentSummary = current === undefined ? undefined : snapshot.byId[current]
  if (currentSummary?.cwd && currentSummary.cwd.trim() !== '') {
    return currentSummary.cwd
  }
  return Object.values(snapshot.byId).find(
    s => s.cwd && s.cwd.trim() !== '' && !s.blank,
  )?.cwd
}

function WorkspaceToolsSurface(props: {
  locale: LocaleService
  t: Translate<WorkspaceMessage>
  service: WorkspaceToolsService
  sidebar: DesktopSidebarService
  sessions: SessionsService
  workspaces: WorkspacesService
}): JSX.Element {
  const t = useTranslate(props.locale, props.t)
  // The sidebar service is the single source of truth; derive the panel
  // geometry with a memo keyed on the exact fields (referentially stable),
  // instead of a second projected store.
  const snapshot = useSyncExternalStore(props.sidebar.subscribe, props.sidebar.getSnapshot)
  const panelState = useMemo(
    () => {
      const active = snapshot.tabs.find(tab => tab.id === snapshot.activeId)
      return {
        maximized: snapshot.maximized,
        open: snapshot.open,
        view: active?.type ?? 'menu',
        width: snapshot.width,
      }
    },
    [snapshot.activeId, snapshot.maximized, snapshot.open, snapshot.tabs, snapshot.width],
  )
  const cwd = activeWorkspace(props.sessions)
  // Identity reactivity rides the runtime's current-session projection
  // (leaf-1.7); the roster itself is read fresh at render so the cwd-driven
  // open policy re-derives on session/workspace switches.
  useSyncExternalStore(props.sessions.currentProvideInfo.subscribe, props.sessions.currentProvideInfo.getSnapshot)
  // The sidebar is its own surface: the file viewer's selection action bar
  // (and comment rails) require an OverlayArbiterProvider. The center column
  // surface mounts its own (CenterSurfaceHost); the sidebar must provide its
  // own so `useOverlayArbiter` never throws outside a provider here.
  const overlayArbiter = useMemo(() => createOverlayArbiter(), [])
  return (
    <OverlayArbiterProvider arbiter={overlayArbiter}>
      <SideToolsPanel
        cwd={cwd}
        open={panelState.open}
        width={panelState.width}
        maximized={panelState.maximized}
        sidebar={props.sidebar}
        t={t}
        onClose={() => { props.service.setOpen(false) }}
        // Drag live-updates the DOM only (preview); pointerup commits the
        // width through the store so publish/persist/claim happen once.
        onResizePreview={width => { props.service.previewResizeWidth(width) }}
        onResize={width => { props.service.commitResizeWidth(width) }}
        onToggleMaximized={() => { props.service.togglePanelMaximized() }}
        onToggleSide={() => { props.service.toggleSidePanel() }}
      />
    </OverlayArbiterProvider>
  )
}

/**
 * The workspace-tools service: the panel-level orchestration behind the
 * sidebar (open/toggle/maximize, review/browser/files/side-chat/trajectory
 * entry points, keymap actions, layout squeeze). Extracted from the former
 * single-file plugin assembly so the built-in tab registrations can depend
 * on it without a plugin.tsx import cycle.
 */
import {
  useSyncExternalStore,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BottomWorkbench } from './bottom-workbench.tsx'
import {
  createMountScheduler,
  findConversationColumn,
  mutationNeedsMount,
} from '../../../shared/column-mount.ts'
import type { DesktopPanels } from '../../../panel-controls/src/client.ts'
import type { PinnedSummary } from '../../../pinned-summary/src/client.ts'
import { basename } from '../../../shared/path.ts'
import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import { useTranslate } from '../../../shared/use-i18n.ts'
import { ToastHost } from '../../../shared/toast.tsx'
import { DialogHost } from './kit/dialog.tsx'
import { SideToolsPanel } from './SideToolsPanel.tsx'
import type { WorkspaceMessage } from './i18n.ts'
import type { DesktopSidebarService, SidebarSnapshot } from './contract.ts'
import {
  binding,
  formatKeymapHint,
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
import sideToolsCss from './side-tools.css'
import workspaceCss from './sidebar.css'
import sourceControlCss from './source-control/source-control.css'
import centerSurfaceCss from './surfaces/center-surface.css'
import diffViewerCss from './diff/diff-viewer.css'
import listRowCss from '../../../shared/list-row.css'
import scrollableCss from '../../../shared/scrollable.css'
import filenameLabelCss from '../../../shared/filename-label.css'
import surfaceTabCss from '../../../shared/surface-tab.css'
import toastCss from '../../../shared/toast.css'
import themeCss from '../../../shared/theme.css'

export class WorkspaceToolsService implements WorkspaceTools {
  private state: WorkspaceToolsState
  private readonly listeners = new Set<() => void>()
  private style: HTMLStyleElement | undefined
  private element: HTMLDivElement | undefined
  private root: Root | undefined
  // The toast host mounts on its own document.body element (the sidebar
  // root is a clipped fixed overlay that only spans the panel footprint,
  // so an in-panel host would hide or misplace toasts).
  private toastElement: HTMLDivElement | undefined
  private toastRoot: Root | undefined
  private stopSidebar: (() => void) | undefined
  private readonly narrowViewport = window.matchMedia('(max-width: 900px)')
  private readonly handleViewportChange = (): void => { this.applyLayout() }
  private stopKeymap: (() => void) | undefined
  private stopChromeGeometry: (() => void) | undefined
  private readonly disposeKeymapActions: Array<() => void> = []
  // The bottom workbench (second pane) lives in the conversation column,
  // above the terminal dock — its own root, like panel-controls'.
  private workbenchElement: HTMLDivElement | undefined
  private workbenchRoot: Root | undefined
  private stopWorkbenchObserver: (() => void) | undefined

  constructor(
    readonly sidebar: DesktopSidebarService,
    private readonly panels: DesktopPanels,
    private readonly locale: LocaleService,
    private readonly t: Translate<WorkspaceMessage>,
    private readonly pinnedSummary: PinnedSummary,
    private readonly sessions: SessionsService,
    private readonly workspaces: WorkspacesService,
  ) {
    this.state = this.project(sidebar.getSnapshot())
  }

  getSnapshot = (): WorkspaceToolsState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  isOpen(): boolean { return this.state.open }

  setOpen(open: boolean): void {
    if (open) this.pinnedSummary.setOpen(false)
    this.sidebar.setOpen(open)
    if (!open) delete document.documentElement.dataset.ohDshPanelMaximized
  }

  toggle(): void {
    if (this.state.open && this.state.view === 'review') this.setOpen(false)
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
    this.pinnedSummary.setOpen(false)
    this.sidebar.openTab({ resource: url, title, type: 'browser' })
    this.sidebar.setOpen(true)
  }

  openFile(path: string): void {
    const title = basename(path)
    this.pinnedSummary.setOpen(false)
    this.sidebar.openTab({ resource: path, title, type: 'file' })
    this.sidebar.setOpen(true)
  }

  openFiles(): void {
    const list = this.sessions.list.getSnapshot()
    const cwd = list.current === undefined ? undefined : list.byId[list.current]?.cwd
    if (cwd === undefined) return
    this.openView('files', cwd)
  }

  openMenu(): void {
    this.pinnedSummary.setOpen(false)
    this.sidebar.activateTab(null)
    this.sidebar.setOpen(true)
  }

  toggleSidePanel(): void {
    if (this.state.open) this.setOpen(false)
    else this.openMenu()
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
    const translated = this.t('trajectory').toLowerCase()
    const tab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find(element => {
        const label = element.textContent?.trim().toLowerCase()
        return label === translated || label === 'trajectory' || label === '轨迹'
      })
    if (tab === undefined) return
    tab.click()
    this.setOpen(false)
  }

  togglePanelMaximized(): void {
    if (!this.state.open) return
    const maximized = !this.state.maximized
    this.sidebar.setMaximized(maximized)
    if (maximized) document.documentElement.dataset.ohDshPanelMaximized = 'true'
    else delete document.documentElement.dataset.ohDshPanelMaximized
  }

  setWidth(width: number): void {
    this.sidebar.setWidth(width)
  }

  mount(): void {
    if (this.state.open) this.pinnedSummary.setOpen(false)
    this.stopSidebar = this.sidebar.subscribe(() => { this.syncSidebar() })
    this.style = document.createElement('style')
    this.style.dataset.ohDshDesktopSidebarStyles = 'true'
    this.style.textContent = `${themeCss}\n${listRowCss}\n${scrollableCss}\n${filenameLabelCss}\n${surfaceTabCss}\n${toastCss}\n${workspaceCss}\n${sideToolsCss}\n${sourceControlCss}
${centerSurfaceCss}
${diffViewerCss}`
    document.head.append(this.style)
    this.element = document.createElement('div')
    this.element.id = 'oh-dsh-sidebar-root'
    // The sidebar is a fixed overlay; #root is left in place (no wrapper, no
    // DOM restructuring). The squeeze is applied as padding-right on #root,
    // coordinated through the desktopPanels right-panel claim.
    document.body.append(this.element)
    this.root = createRoot(this.element)
    this.root.render(
      <WorkspaceToolsSurface
        locale={this.locale}
        t={this.t}
        service={this}
        panels={this.panels}
        sessions={this.sessions}
        workspaces={this.workspaces}
        sidebar={this.sidebar}
      />,
    )
    this.toastElement = document.createElement('div')
    this.toastElement.id = 'oh-dsh-toast-root'
    document.body.append(this.toastElement)
    this.toastRoot = createRoot(this.toastElement)
    this.toastRoot.render(
      <>
        <ToastHost />
        <DialogHost />
      </>,
    )
    this.narrowViewport.addEventListener('change', this.handleViewportChange)
    this.stopKeymap = installKeymap()
    // Window-chrome geometry (traffic lights / Windows overlay caption) →
    // the top rail's left/right reservation CSS variables.
    this.stopChromeGeometry = applyChromeGeometry()
    // Global (panel-level) shortcuts: registered for the app lifetime.
    // Surface-scoped shortcuts register from their mounted views.
    this.mountBottomWorkbench()
    this.disposeKeymapActions.push(
      registerKeymapAction('panel.toggle', binding({ mod: true, alt: true, key: 'b' }), () => {
        this.toggleSidePanel()
        return true
      }),
      registerKeymapAction('panel.maximizeEscape', binding({ key: 'Escape' }), () => {
        if (!this.state.maximized) return false
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
    this.stopWorkbenchObserver?.()
    this.stopWorkbenchObserver = undefined
    this.workbenchRoot?.unmount()
    this.workbenchRoot = undefined
    this.workbenchElement?.remove()
    this.workbenchElement = undefined
    this.narrowViewport.removeEventListener('change', this.handleViewportChange)
    this.root?.unmount()
    this.element?.remove()
    this.toastRoot?.unmount()
    this.toastElement?.remove()
    this.style?.remove()
    delete document.documentElement.dataset.ohDshDesktopSidebarOpen
    delete document.documentElement.dataset.ohDshPanelMaximized
    document.documentElement.style.removeProperty('--oh-dsh-sidebar-width')
    this.panels.releaseRightPanel('sidebar')
  }

  private publish(next: WorkspaceToolsState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  private openView(view: string, resource?: string): void {
    this.pinnedSummary.setOpen(false)
    this.sidebar.openTab({
      type: view,
      ...(resource !== undefined ? { resource } : {}),
    })
    this.sidebar.setOpen(true)
  }

  private project(snapshot: SidebarSnapshot): WorkspaceToolsState {
    const active = snapshot.tabs.find(tab => tab.id === snapshot.activeId)
    return {
      maximized: snapshot.maximized,
      open: snapshot.open,
      view: active?.type ?? 'menu',
      width: snapshot.width,
    }
  }

  private syncSidebar(): void {
    const next = this.project(this.sidebar.getSnapshot())
    if (next.open) this.pinnedSummary.setOpen(false)
    this.publish(next)
    if (next.maximized) {
      document.documentElement.dataset.ohDshPanelMaximized = 'true'
    } else {
      delete document.documentElement.dataset.ohDshPanelMaximized
    }
    this.applyLayout()
  }

  /**
   * Mount the bottom workbench into the conversation column, ABOVE the
   * terminal dock (panel-controls keeps the dock last; the workbench
   * inserts before `#oh-dsh-terminal-root` when it exists, appends
   * otherwise).
   *
   * The column (`[data-phase]`'s parent) is rendered by DSH after this
   * plugin's own `mount()` runs, so a single eager attempt would silently
   * fail — the same self-healing scheduler + document observer pattern
   * panel-controls uses for the terminal dock retries on every relevant DOM
   * mutation until the column exists and the element stays in position.
   */
  private mountBottomWorkbench(): void {
    const ownedRoot = '#oh-dsh-bottom-workbench-root'
    let element = this.workbenchElement
    if (element === undefined) {
      element = document.createElement('div')
      element.id = 'oh-dsh-bottom-workbench-root'
      element.style.display = 'contents'
      this.workbenchElement = element
    }
    let root = this.workbenchRoot
    if (root === undefined) {
      root = createRoot(element)
      this.workbenchRoot = root
    }
    const mount = (): void => {
      const column = findConversationColumn()
      if (column === null) return
      if (element.isConnected && element.parentElement === column) return
      column.insertBefore(element, column.querySelector('#oh-dsh-terminal-root'))
      root.render(
        <BottomWorkbench sidebar={this.sidebar} t={this.t} />,
      )
    }
    mount()
    const scheduler = createMountScheduler(mount)
    const observer = new MutationObserver(records => {
      // Ignore our own DOM writes (the element itself) so the observer does
      // not wake itself in an endless loop.
      if (records.some(record => mutationNeedsMount(record, ownedRoot))) {
        scheduler.schedule()
      }
    })
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-details-collapsed', 'data-sidebar-collapsed', 'data-phase'],
      childList: true,
      subtree: true,
    })
    this.stopWorkbenchObserver = () => {
      observer.disconnect()
      scheduler.cancel()
    }
  }

  private applyLayout(): void {
    document.documentElement.style.setProperty('--oh-dsh-sidebar-width', `${String(this.state.width)}px`)
    const html = document.documentElement
    // Narrow viewports (< 900px) open the sidebar as a full-width drawer:
    // squeezing #root by the panel width would leave the app unusable, and
    // collapsing the container to 0 (the old behavior) made an open sidebar
    // invisible — "closed but cannot reopen".
    const fullWidth = this.state.maximized || this.narrowViewport.matches
    // The full-width state drives the side panel's top-row chrome
    // reservation (its top row starts at x=0, under the traffic lights) —
    // see side-tools.css. Published as an attribute so CSS keys off it
    // directly; no measuring, no observers.
    if (this.state.open && fullWidth) {
      html.dataset.ohDshSidebarFullWidth = 'true'
    } else {
      delete html.dataset.ohDshSidebarFullWidth
    }
    if (this.state.open) {
      html.dataset.ohDshDesktopSidebarOpen = 'true'
      // The #root squeeze is owned by the desktopPanels right-panel
      // coordinator — claim the footprint instead of writing global state.
      // The overlay container is flush with the window's right edge (no
      // right inset anymore), so the squeeze equals the panel width: the
      // app's center column ends exactly at the panel's left edge.
      this.panels.claimRightPanel('sidebar', {
        paddingRight: fullWidth
          ? '100vw'
          : `${String(this.state.width)}px`,
      })
    } else {
      delete html.dataset.ohDshDesktopSidebarOpen
      this.panels.releaseRightPanel('sidebar')
    }
    // The overlay container only occupies the panel footprint while open on
    // wide viewports; closed it collapses to 0 so it never intercepts
    // pointer events over the app (pointer-events: none is defense-in-depth).
    if (this.element !== undefined) {
      this.element.style.width = this.state.open
        ? (fullWidth ? '100vw' : `${String(this.state.width)}px`)
        : '0px'
    }
  }
}

function WorkspaceToolsSurface(props: {
  locale: LocaleService
  t: Translate<WorkspaceMessage>
  service: WorkspaceToolsService
  sidebar: DesktopSidebarService
  panels: DesktopPanels
  sessions: SessionsService
  workspaces: WorkspacesService
}): JSX.Element {
  const t = useTranslate(props.locale, props.t)
  const panelState = useSyncExternalStore(props.service.subscribe, props.service.getSnapshot)
  const sessionList = useSyncExternalStore(props.sessions.list.subscribe, props.sessions.list.getSnapshot)
  const cwd = sessionList.current === undefined ? undefined : sessionList.byId[sessionList.current]?.cwd
  return (
    <>
      <SideToolsPanel
        cwd={cwd}
        open={panelState.open}
        width={panelState.width}
        maximized={panelState.maximized}
        sidebar={props.sidebar}
        panels={props.panels}
        t={t}
        onClose={() => { props.service.setOpen(false) }}
        onResize={width => { props.service.setWidth(width) }}
        onToggleMaximized={() => { props.service.togglePanelMaximized() }}
        onToggleSide={() => { props.service.toggleSidePanel() }}
      />
    </>
  )
}

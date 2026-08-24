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
} from '@dsh-studio/shared/column-mount'
import type { DesktopPanels } from '@dsh-studio/panel-controls/client'
import type { PinnedSummary } from '@dsh-studio/pinned-summary/client'
import { basename } from '@dsh-studio/shared/path'
import type { LocaleService, Translate } from '@dsh-studio/shared/i18n'
import { useTranslate } from '@dsh-studio/shared/use-i18n'
import { ensureStyle } from '@dsh-studio/shared/style-injector'
import { ToastHost } from '@dsh-studio/shared/toast'
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
import { trajectoryTabButton } from './surfaces/dsh-dom.ts'
import {
  clampSidebarWidthForLayout,
  SIDEBAR_COLLAPSE_THRESHOLD_PX,
} from '../sidebar-preferences.ts'
import sideToolsCss from './side-tools.css'
import workspaceCss from './sidebar.css'
import sourceControlCss from './source-control/source-control.css'
import centerSurfaceCss from './surfaces/center-surface.css'
import diffViewerCss from './diff/diff-viewer.css'
import { ensureSharedUiStyles } from '@dsh-studio/shared/ui'
import { pluginCss as sidebarSurfaceCss } from './styles.js'
import terminalViewCss from '@dsh-studio/shared/terminal-view.css'
import xtermCss from '@xterm/xterm/css/xterm.css'

export class WorkspaceToolsService implements WorkspaceTools {
  private state: WorkspaceToolsState
  private readonly listeners = new Set<() => void>()
  private stopSharedStyle: (() => void) | undefined
  private stopStyle: (() => void) | undefined
  private element: HTMLDivElement | undefined
  private root: Root | undefined
  // The toast host mounts on its own document.body element (the sidebar
  // root is a clipped fixed overlay that only spans the panel footprint,
  // so an in-panel host would hide or misplace toasts).
  private toastElement: HTMLDivElement | undefined
  private toastRoot: Root | undefined
  private stopSidebar: (() => void) | undefined
  private resizing = false
  private stopKeymap: (() => void) | undefined
  private stopChromeGeometry: (() => void) | undefined
  private readonly disposeKeymapActions: Array<() => void> = []
  // CUT (user preference): the bottom workbench (second pane) is no longer
  // mounted under the conversation column — see mountBottomWorkbench below.
  // private workbenchElement: HTMLDivElement | undefined
  // private workbenchRoot: Root | undefined
  // private stopWorkbenchObserver: (() => void) | undefined

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

  /**
   * A3: the ONE place encoding the right-panel ↔ pinned-summary mutual
   * exclusion — opening or widening the side panel collapses the pinned
   * summary card (and vice versa, enforced by the summary's own claim).
   * Every panel-opening entry point funnels through here so the policy has
   * exactly one home instead of being re-stated at each call site.
   */
  private claimPanelExclusivity(): void {
    this.pinnedSummary.setOpen(false)
  }

  isOpen(): boolean { return this.state.open }

  setOpen(open: boolean): void {
    if (open) this.claimPanelExclusivity()
    this.sidebar.setOpen(open)
    if (!open) delete document.documentElement.dataset.dshStudioPanelMaximized
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
    const list = this.sessions.list.getSnapshot()
    const cwd = list.current === undefined ? undefined : list.byId[list.current]?.cwd
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
    const list = this.sessions.list.getSnapshot()
    const cwd = list.current === undefined ? undefined : list.byId[list.current]?.cwd
    if (cwd === undefined || cwd === '') return
    this.openView('files', cwd)
  }

  openMenu(): void {
    this.claimPanelExclusivity()
    this.sidebar.activateTab(null)
    this.sidebar.setOpen(true)
  }

  toggleSidePanel(): void {
    if (this.state.open) this.setOpen(false)
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
    if (!this.state.open) return
    const maximized = !this.state.maximized
    this.sidebar.setMaximized(maximized)
    if (maximized) document.documentElement.dataset.dshStudioPanelMaximized = 'true'
    else delete document.documentElement.dataset.dshStudioPanelMaximized
  }

  setWidth(width: number): void {
    this.sidebar.setWidth(clampSidebarWidthForLayout(width))
  }

  /**
   * Live drag preview (pointermove hot path). The width is written straight
   * to the DOM (CSS variable + overlay size + the `#root` squeeze) without
   * touching the sidebar store, React state, persistence or the
   * DesktopPanels claim coordinator — so a frame of pointermove never
   * commits a React tree, a localStorage write, or a theme observer hit.
   * The final value is committed by {@link commitResizeWidth} on pointerup.
   */
  previewResizeWidth(rawWidth: number): void {
    if (rawWidth < SIDEBAR_COLLAPSE_THRESHOLD_PX) {
      this.resizing = true
      const html = document.documentElement
      html.style.setProperty('--dsh-studio-sidebar-width', '0px')
      if (this.element !== undefined) this.element.style.width = '0px'
      if (this.state.open) this.panels.previewRightPanel('0px')
      return
    }
    this.resizing = true
    const width = clampSidebarWidthForLayout(rawWidth)
    const fullWidth = this.state.maximized
    const html = document.documentElement
    html.style.setProperty('--dsh-studio-sidebar-width', `${String(width)}px`)
    if (this.element !== undefined) {
      this.element.style.width = this.state.open
        ? (fullWidth ? '100vw' : `${String(width)}px`)
        : '0px'
    }
    if (this.state.open) {
      // Mirror what claimRightPanel would produce once committed. While the
      // panel is dragged the sidebar is the only right-panel adapter moving;
      // the commit below re-asserts the claim so the coordinator stays the
      // owner of record.
      this.panels.previewRightPanel(this.state.open && fullWidth ? '100vw' : `${String(width)}px`)
    }
  }

  /** End of a live drag: commit the final width through the store (which
   *  publishes, persists and re-asserts the right-panel claim). */
  commitResizeWidth(rawWidth: number): void {
    this.resizing = false
    if (rawWidth < SIDEBAR_COLLAPSE_THRESHOLD_PX) {
      this.setOpen(false)
      return
    }
    const width = clampSidebarWidthForLayout(rawWidth)
    if (width !== this.state.width) {
      this.sidebar.setWidth(width)
      // setWidth publishes → syncSidebar → applyLayout() when it changed.
      return
    }
    // Same width as the committed store value: the preview DOM writes are
    // already final, but re-run layout so claim/padding stay authoritative
    // (the preview bypassed the claim coordinator).
    this.applyLayout()
  }

  mount(): void {
    if (this.state.open) this.claimPanelExclusivity()
    this.stopSidebar = this.sidebar.subscribe(() => { this.syncSidebar() })
    this.stopSharedStyle = ensureSharedUiStyles('dsh-studio-sidebar-shared-ui')
    this.stopStyle = ensureStyle('dsh-studio-sidebar', [
      xtermCss,
      terminalViewCss,
      // Strangler transition: the scoped module stylesheet feeds the future
      // class-map references; the legacy global texts below still serve the
      // not-yet-migrated literal class names and stay LAST so their global
      // selectors keep winning during the migration (identical to today).
      sidebarSurfaceCss,
      workspaceCss,
      sideToolsCss,
      sourceControlCss,
      centerSurfaceCss,
      diffViewerCss,
    ].join('\n'))
    this.element = document.createElement('div')
    this.element.id = 'dsh-studio-sidebar-root'
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
    this.toastElement.id = 'dsh-studio-toast-root'
    document.body.append(this.toastElement)
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
    // Global (panel-level) shortcuts: registered for the app lifetime.
    // Surface-scoped shortcuts register from their mounted views.
    // CUT: the bottom workbench no longer mounts under the conversation
    // column (user preference); keep the panel-level shortcuts below.
    // this.mountBottomWorkbench()
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
    // CUT: bottom-workbench cleanup (workbench root / element / observer)
    // removed with the mounting chain.
    // this.stopWorkbenchObserver?.()
    // this.stopWorkbenchObserver = undefined
    // this.workbenchRoot?.unmount()
    // this.workbenchRoot = undefined
    // this.workbenchElement?.remove()
    // this.workbenchElement = undefined
    delete document.documentElement.dataset.dshStudioRightPanelWidth
    this.root?.unmount()
    this.element?.remove()
    this.toastRoot?.unmount()
    this.toastElement?.remove()
    this.stopSharedStyle?.()
    this.stopSharedStyle = undefined
    this.stopStyle?.()
    this.stopStyle = undefined
    delete document.documentElement.dataset.dshStudioDesktopSidebarOpen
    delete document.documentElement.dataset.dshStudioPanelMaximized
    document.documentElement.style.removeProperty('--dsh-studio-sidebar-width')
    this.panels.releaseRightPanel('sidebar')
  }

  private publish(next: WorkspaceToolsState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  private openView(view: string, resource?: string): void {
    this.claimPanelExclusivity()
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
    if (next.open) this.claimPanelExclusivity()
    this.publish(next)
    if (next.maximized) {
      document.documentElement.dataset.dshStudioPanelMaximized = 'true'
    } else {
      delete document.documentElement.dataset.dshStudioPanelMaximized
    }
    this.applyLayout()
  }

  /**
   * CUT (user preference): the bottom workbench is no longer mounted under
   * the conversation column (its empty strip was persistent "hanging below
   * the middle chain"). Restore by re-adding the workbench fields, this
   * mount body and the `mountBottomWorkbench()` call in `mount()`.
   */
  private mountBottomWorkbench(): void {}

  private applyLayout(): void {
    const html = document.documentElement
    const fullWidth = this.state.maximized
    const widthCss = `${String(this.state.width)}px`
    const overlayWidth = this.state.open
      ? (fullWidth ? '100vw' : widthCss)
      : '0px'

    // Dirty-checked writes: every one of these lands on `html.style` or an
    // element style, and a no-op write would still trip the terminal theme
    // observer / cascade a ResizeObserver. Only touch what actually changed.
    if (html.style.getPropertyValue('--dsh-studio-sidebar-width') !== widthCss) {
      html.style.setProperty('--dsh-studio-sidebar-width', widthCss)
    }
    // Full-width only for explicit maximize; the window minWidth guarantees
    // both side panels always fit, so no viewport-driven drawer mode exists.
    if (this.state.open && fullWidth) {
      if (html.dataset.dshStudioSidebarFullWidth !== 'true') html.dataset.dshStudioSidebarFullWidth = 'true'
    } else if (html.dataset.dshStudioSidebarFullWidth !== undefined) {
      delete html.dataset.dshStudioSidebarFullWidth
    }
    if (this.state.open) {
      if (html.dataset.dshStudioDesktopSidebarOpen !== 'true') html.dataset.dshStudioDesktopSidebarOpen = 'true'
      // Publish the resolved footprint so the DSH AppFrame patch can include
      // the plugin rail in its viewport-budget (forced-close) calculation.
      const px = String(fullWidth ? window.innerWidth : this.state.width)
      if (html.dataset.dshStudioRightPanelWidth !== px) html.dataset.dshStudioRightPanelWidth = px
      // The #root squeeze is owned by the desktopPanels right-panel
      // coordinator — claim the footprint instead of writing global state.
      // The overlay container is flush with the window's right edge (no
      // right inset anymore), so the squeeze equals the panel width: the
      // app's center column ends exactly at the panel's left edge.
      this.panels.claimRightPanel('sidebar', {
        paddingRight: fullWidth ? '100vw' : widthCss,
      })
    } else {
      delete html.dataset.dshStudioDesktopSidebarOpen
      if (html.dataset.dshStudioRightPanelWidth !== undefined) delete html.dataset.dshStudioRightPanelWidth
      this.panels.releaseRightPanel('sidebar')
    }
    // The overlay container only occupies the panel footprint while open on
    // wide viewports; closed it collapses to 0 so it never intercepts
    // pointer events over the app (pointer-events: none is defense-in-depth).
    if (this.element !== undefined && this.element.style.width !== overlayWidth) {
      this.element.style.width = overlayWidth
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
  const current = sessionList.current
  const currentSummary = current === undefined ? undefined : sessionList.byId[current]
  const cwd = (currentSummary?.cwd && currentSummary.cwd.trim() !== '')
    ? currentSummary.cwd
    : Object.values(sessionList.byId).find(s => s.cwd && s.cwd.trim() !== '' && !s.blank)?.cwd
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
        // Drag live-updates the DOM only (preview); pointerup commits the
        // width through the store so publish/persist/claim happen once.
        onResizePreview={width => { props.service.previewResizeWidth(width) }}
        onResize={width => { props.service.commitResizeWidth(width) }}
        onToggleMaximized={() => { props.service.togglePanelMaximized() }}
        onToggleSide={() => { props.service.toggleSidePanel() }}
      />
    </>
  )
}

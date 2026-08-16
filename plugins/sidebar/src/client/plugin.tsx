/**
 * Desktop sidebar client plugin assembly.
 *
 * Keeps only the service orchestration, the shell components, and the
 * built-in tab/viewer registry; the workspace Git Review panel, the settings
 * section, the file viewers, the interception layer, and the shared client
 * types live in their own modules:
 *   - workspace-panel.tsx  — WorkspacePanel (changes / history / comments)
 *   - settings.tsx         — SidebarSettingsRow + sync
 *   - file-viewers.tsx     — text / binary / html viewers
 *   - intercept.ts         — openPath + link interception (registry-based)
 *   - client-types.ts      — shared structural client types
 */
import {
  useSyncExternalStore,
} from 'react'
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createRoot, type Root } from 'react-dom/client'
import type { DesktopPanels } from '../../../panel-controls/src/client.ts'
import type { PinnedSummary } from '../../../pinned-summary/src/client.ts'
import {
  FilesView,
  FileView,
  SideToolsPanel,
  ToolIcon,
} from './SideToolsPanel.tsx'
import sideToolsCss from './side-tools.css'
import workspaceCss from './sidebar.css'
import sourceControlCss from './source-control/source-control.css'
import centerSurfaceCss from './surfaces/center-surface.css'
import diffViewerCss from './diff/diff-viewer.css'
import listRowCss from '../../../shared/list-row.css'
import filenameLabelCss from '../../../shared/filename-label.css'
import surfaceTabCss from '../../../shared/surface-tab.css'
import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import { useTranslate } from '../../../shared/use-i18n.ts'
import themeCss from '../../../shared/theme.css'
import { WORKSPACE_MESSAGES, type WorkspaceMessage } from './i18n.ts'
import ReactMarkdown from 'react-markdown'
import {
  CenterSurfaceHost,
  centerSurfaceRendererRegistry,
} from './surfaces/center-surface-host.tsx'
import {
  CommitDiffSurfaceView,
  CommitFileSurfaceView,
  CommittedSurfaceView,
  ConflictSurfaceView,
  DiffAllSurfaceView,
  DiffSurfaceView,
  EditorSurfaceView,
  FileSurfaceView,
} from './surfaces/renderers.tsx'
import {
  DesktopSidebarService,
  type DesktopSidebar,
  type DesktopSidebarSnapshot,
} from './sidebar-service.ts'
import { LocalStorageSidebarPreferencesStorage } from './sidebar-storage.ts'
import { DEFAULT_SIDEBAR_PREFERENCES } from '../sidebar-preferences.ts'
import {
  ReviewCommentsService,
  type ReviewInputTriggersService,
} from './review/review-comments.ts'
import {
  SidebarRuntimeSettingsService,
} from './runtime-settings.ts'
import type {
  BoundSidebarSettingsActions,
  ClientContext,
  SessionsService,
  SidebarSettingsState,
  SlotsService,
  WorkspaceTools,
  WorkspaceToolsState,
  WorkspacesService,
} from './client-types.ts'
import { WorkspacePanel } from './workspace-panel.tsx'
import {
  BinaryFileViewer,
  HtmlFileViewer,
  TextFileViewer,
} from './files/file-viewers.tsx'
import { SidebarSettingsRow, syncSidebarSettings } from './settings.tsx'
import { disposeSidebarRuntimes } from './runtimes/registry.ts'
import { binding, installKeymap, registerKeymapAction } from './kit/keymap.ts'
import {
  acquireOpenPathPatch,
  registerLinkHandler,
  registerLinkInterception,
  registerOpenPathHandler,
  releaseOpenPathPatch,
} from './intercept.ts'

class WorkspaceToolsService implements WorkspaceTools {
  private state: WorkspaceToolsState
  private readonly listeners = new Set<() => void>()
  private style: HTMLStyleElement | undefined
  private element: HTMLDivElement | undefined
  private root: Root | undefined
  private stopSidebar: (() => void) | undefined
  private readonly narrowViewport = window.matchMedia('(max-width: 900px)')
  private readonly handleViewportChange = (): void => { this.applyLayout() }
  private stopKeymap: (() => void) | undefined
  private readonly disposeKeymapActions: Array<() => void> = []

  constructor(
    readonly sidebar: DesktopSidebar,
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
    try { title = new URL(url).hostname || url } catch {}
    this.pinnedSummary.setOpen(false)
    this.sidebar.openTab({ resource: url, title, type: 'browser' })
    this.sidebar.setOpen(true)
  }

  openFile(path: string): void {
    const title = path.split(/[\\/]/).filter(Boolean).pop() ?? path
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
    this.style.textContent = `${themeCss}\n${listRowCss}\n${filenameLabelCss}\n${surfaceTabCss}\n${workspaceCss}\n${sideToolsCss}\n${sourceControlCss}
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
    this.narrowViewport.addEventListener('change', this.handleViewportChange)
    this.stopKeymap = installKeymap()
    // Global (panel-level) shortcuts: registered for the app lifetime.
    // Surface-scoped shortcuts register from their mounted views.
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
    this.narrowViewport.removeEventListener('change', this.handleViewportChange)
    this.root?.unmount()
    this.element?.remove()
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

  private project(snapshot: DesktopSidebarSnapshot): WorkspaceToolsState {
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

  private applyLayout(): void {
    document.documentElement.style.setProperty('--oh-dsh-sidebar-width', `${String(this.state.width)}px`)
    const html = document.documentElement
    // Narrow viewports (< 900px) open the sidebar as a full-width drawer:
    // squeezing #root by the panel width would leave the app unusable, and
    // collapsing the container to 0 (the old behavior) made an open sidebar
    // invisible — "closed but cannot reopen".
    const fullWidth = this.state.maximized || this.narrowViewport.matches
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
  sidebar: DesktopSidebar
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

function activeWorkspace(sessions: SessionsService): string | undefined {
  const snapshot = sessions.list.getSnapshot()
  return snapshot.current === undefined
    ? undefined
    : snapshot.byId[snapshot.current]?.cwd
}

function activeSidebarScope(sessions: SessionsService): {
  sessionId: string
  cwd: string
} | undefined {
  const snapshot = sessions.list.getSnapshot()
  if (snapshot.current === undefined) return undefined
  const cwd = snapshot.byId[snapshot.current]?.cwd
  return cwd === undefined ? undefined : { sessionId: snapshot.current, cwd }
}

function registerBuiltinSidebarTools(options: {
  openExternalPath(path: string): Promise<void>
  panels: DesktopPanels
  reviewComments: ReviewCommentsService
  service: WorkspaceToolsService
  sessions: SessionsService
  sidebar: DesktopSidebar
  t: Translate<WorkspaceMessage>
  workspaces: WorkspacesService
}): () => void {
  const {
    openExternalPath,
    panels,
    reviewComments,
    service,
    sessions,
    sidebar,
    t,
    workspaces,
  } = options
  const disposers = [
    sidebar.registerTab({
      chrome: 'custom',
      icon: <ToolIcon kind="review" />,
      id: 'review',
      order: 10,
      render: () => (
        <WorkspacePanel
          reviewComments={reviewComments}
          service={service}
          sessions={sessions}
          workspaces={workspaces}
          t={t}
        />
      ),
      requiresWorkspace: true,
      shortcut: '⌃⇧G',
      single: true,
      title: () => t('review'),
    }),
    sidebar.registerTab({
      action: () => { panels.toggleBottomPanel() },
      icon: <ToolIcon kind="terminal" />,
      id: 'terminal',
      order: 20,
      shortcut: '⌘J',
      title: () => t('terminal'),
    }),
    sidebar.registerTab({
      dedupeKey: tab => tab.resource,
      icon: <ToolIcon kind="files" />,
      id: 'files',
      order: 40,
      render: props => (
        <FilesView
          {...props}
          scope={activeSidebarScope(sessions)}
          sidebar={sidebar}
          t={t}
        />
      ),
      requiresWorkspace: true,
      shortcut: '⌘P',
      title: () => t('files'),
    }),
    sidebar.registerTab({
      dedupeKey: tab => tab.resource,
      hidden: true,
      icon: <ToolIcon kind="file" />,
      id: 'file',
      render: props => (
        <FileView
          {...props}
          scope={activeSidebarScope(sessions)}
          onOpenPath={openExternalPath}
          sidebar={sidebar}
          t={t}
        />
      ),
      requiresWorkspace: true,
      title: () => t('files'),
    }),
    sidebar.registerTab({
      action: async () => { await service.openSideChat() },
      icon: <ToolIcon kind="chat" />,
      id: 'side-chat',
      order: 50,
      shortcut: '⌥⌘S',
      title: () => t('side-chat'),
    }),
    sidebar.registerTab({
      action: () => { service.openTrajectory() },
      icon: <ToolIcon kind="trajectory" />,
      id: 'trajectory',
      order: 60,
      requiresWorkspace: true,
      title: () => t('trajectory'),
    }),
    sidebar.registerViewer({
      detect: (_path, head) => head.includes(0),
      extensions: [],
      fetchStrategy: 'binary-download',
      id: 'binary',
      order: 100,
      render: input => (
        <BinaryFileViewer
          onOpen={async () => { await openExternalPath(input.path) }}
          path={input.path}
          title={input.title}
          t={t}
        />
      ),
      title: () => t('files.viewer.binary'),
    }),
    sidebar.registerViewer({
      extensions: ['html', 'htm'],
      fetchStrategy: 'text',
      id: 'html',
      order: 30,
      render: input => (
        <HtmlFileViewer
          content={input.content ?? ''}
          path={input.path}
          title={input.title}
        />
      ),
      title: () => t('files.viewer.html'),
    }),
    sidebar.registerViewer({
      extensions: ['md', 'markdown', 'mdx'],
      fetchStrategy: 'text',
      id: 'markdown',
      order: 20,
      render: input => (
        <div className="oh-dsh-content-markdown">
          <ReactMarkdown>{input.content ?? ''}</ReactMarkdown>
        </div>
      ),
      title: () => t('files.viewer.markdown'),
    }),
    sidebar.registerViewer({
      extensions: [],
      fetchStrategy: 'text',
      id: 'text',
      order: -100,
      render: input => (
        <TextFileViewer
          content={input.content ?? ''}
          path={input.path}
          title={input.title}
        />
      ),
      title: () => t('files.viewer.text'),
    }),
  ]
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

/** Register the built-in center surface renderers (file / diff / browser). */
function registerCenterSurfaceRenderers(t: Translate<WorkspaceMessage>): void {
  centerSurfaceRendererRegistry.register('file', surface => {
    if (surface.kind !== 'file') return null
    return <FileSurfaceView surface={surface} t={t} />
  })
  centerSurfaceRendererRegistry.register('editor', surface => {
    if (surface.kind !== 'editor') return null
    return <EditorSurfaceView surface={surface} t={t} />
  })
  centerSurfaceRendererRegistry.register('diff', surface => {
    if (surface.kind !== 'diff') return null
    return <DiffSurfaceView surface={surface} t={t} />
  })
  centerSurfaceRendererRegistry.register('diff-all', surface => {
    if (surface.kind !== 'diff-all') return null
    return <DiffAllSurfaceView surface={surface} t={t} />
  })
  centerSurfaceRendererRegistry.register('commit', surface => {
    if (surface.kind !== 'commit') return null
    return <CommitDiffSurfaceView surface={surface} t={t} />
  })
  centerSurfaceRendererRegistry.register('commit-file', surface => {
    if (surface.kind !== 'commit-file') return null
    return <CommitFileSurfaceView surface={surface} t={t} />
  })
  centerSurfaceRendererRegistry.register('committed', surface => {
    if (surface.kind !== 'committed') return null
    return <CommittedSurfaceView surface={surface} t={t} />
  })
  centerSurfaceRendererRegistry.register('conflict', surface => {
    if (surface.kind !== 'conflict') return null
    return <ConflictSurfaceView surface={surface} t={t} />
  })
}

export const inject = [
  'desktopPanels',
  'locale',
  'pinnedSummary',
  'sessions',
  'inputTriggers',
  'slots',
  'workspaces',
]

function pathBelongsToActiveWorkspace(
  sessions: SessionsService,
  path: string,
): boolean {
  const cwd = activeWorkspace(sessions)
  if (cwd === undefined) return false
  const normalizedRoot = cwd.replaceAll('\\', '/').replace(/\/+$/, '')
  const normalizedPath = path.replaceAll('\\', '/').replace(/\/+$/, '')
  return normalizedPath === normalizedRoot
    || normalizedPath.startsWith(`${normalizedRoot}/`)
}

export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  const slots = ctx.get('slots') as SlotsService
  const t: Translate<WorkspaceMessage> = locale.bind('oh-dsh.sidebar')
  ctx.effect(
    () => locale.register('oh-dsh.sidebar', WORKSPACE_MESSAGES),
    'oh-dsh-desktop: workspace tools dictionaries',
  )
  const panels = ctx.get('desktopPanels') as DesktopPanels
  const pinnedSummary = ctx.get('pinnedSummary') as PinnedSummary
  const sessions = ctx.get('sessions') as SessionsService
  const inputTriggers = ctx.get('inputTriggers') as ReviewInputTriggersService
  const workspaces = ctx.get('workspaces') as WorkspacesService
  // Capture the ORIGINAL openPath before the interception patch installs
  // (the effect below runs after this body): external opens must bypass the
  // interceptor to avoid re-entering it.
  const originalOpenPath = workspaces.openPath
  const openExternalPath = async (path: string): Promise<void> => {
    await originalOpenPath.call(workspaces, path)
  }
  const reviewComments = new ReviewCommentsService(
    sessions,
    inputTriggers,
    window.localStorage,
  )
  const desktopSidebar = new DesktopSidebarService(
    new LocalStorageSidebarPreferencesStorage(),
  )
  const runtimeSettings = new SidebarRuntimeSettingsService()
  const service = new WorkspaceToolsService(
    desktopSidebar,
    panels,
    locale,
    t,
    pinnedSummary,
    sessions,
    workspaces,
  )
  const unregisterBuiltins = registerBuiltinSidebarTools({
    openExternalPath,
    panels,
    reviewComments,
    service,
    sessions,
    sidebar: desktopSidebar,
    t,
    workspaces,
  })
  const settingsStore = defineStore({
    init: (): SidebarSettingsState => ({
      openByDefault: false,
      revision: -1,
      tabsEnabled: {},
      viewersEnabled: {},
      width: DEFAULT_SIDEBAR_PREFERENCES.defaultWidth,
    }),
    actions: {
      sync: (
        draft,
        openByDefault: boolean,
        revision: number,
        tabsEnabled: Record<string, boolean>,
        viewersEnabled: Record<string, boolean>,
        width: number,
      ) => {
        if (revision < draft.revision) return
        draft.openByDefault = openByDefault
        draft.revision = revision
        draft.tabsEnabled = tabsEnabled
        draft.viewersEnabled = viewersEnabled
        draft.width = width
      },
    },
  })
  let settingsActions: BoundSidebarSettingsActions | undefined
  ctx.effect(() => {
    const syncSession = (): void => {
      desktopSidebar.setSession(sessions.list.getSnapshot().current ?? null)
    }
    syncSession()
    const stopSessions = sessions.list.subscribe(syncSession)
    const stopSettings = desktopSidebar.subscribe(() => {
      syncSidebarSettings(settingsActions, desktopSidebar.getSnapshot())
    })
    const syncRuntime = (): void => {
      panels.setAutoOpenTerminal(
        runtimeSettings.getSnapshot().preferences.bottomPanelAutoTerminal,
      )
    }
    const stopRuntime = runtimeSettings.subscribe(syncRuntime)
    // openPath interception through the registry: the patch is installed
    // once (refcounted) and this activation only registers its handler.
    const stopOpenPath = registerOpenPathHandler(async (path): Promise<boolean> => {
      const runtime = runtimeSettings.getSnapshot().preferences
      const snapshot = desktopSidebar.getSnapshot()
      if (runtime.interceptOpenPath
        && snapshot.ready
        && desktopSidebar.isTabEnabled('file')
        && pathBelongsToActiveWorkspace(sessions, path)) {
        service.openFile(path)
        return true
      }
      return false
    })
    // External-link interception through the registry (Ctrl/Cmd+click and
    // same-origin links always bypass).
    const stopLink = registerLinkHandler((url): boolean => {
      const runtime = runtimeSettings.getSnapshot().preferences
      const snapshot = desktopSidebar.getSnapshot()
      if (!runtime.browserInterceptLinks
        || !snapshot.ready
        || !desktopSidebar.isTabEnabled('browser')) return false
      service.openBrowserUrl(url.href)
      return true
    })
    acquireOpenPathPatch(workspaces)
    const stopLinkDom = registerLinkInterception()
    syncRuntime()
    void runtimeSettings.start()
    void desktopSidebar.start()
    service.mount()
    // Center surface module: renderer registry + the middle-area tab host.
    registerCenterSurfaceRenderers(t)
    const centerSurfaceHost = new CenterSurfaceHost({ sessions, t, sidebar: desktopSidebar })
    centerSurfaceHost.mount()
    const removeSidebar = ctx.reflect.provide(
      'desktopSidebar',
      desktopSidebar,
      undefined,
    )
    const removeService = ctx.reflect.provide('workspaceTools', service, undefined)
    return () => {
      stopSessions()
      stopSettings()
      stopRuntime()
      stopOpenPath()
      stopLink()
      stopLinkDom()
      releaseOpenPathPatch(workspaces)
      centerSurfaceHost.dispose()
      service.dispose()
      unregisterBuiltins()
      reviewComments.dispose()
      desktopSidebar.dispose()
      runtimeSettings.dispose()
      disposeSidebarRuntimes()
      void removeSidebar?.()
      void removeService?.()
    }
  }, 'oh-dsh-desktop: workspace tools')

  slots.inject('settings.section', () => slots.register({
    id: 'oh-dsh-sidebar',
    inject: actions => {
      settingsActions = actions
      syncSidebarSettings(settingsActions, desktopSidebar.getSnapshot())
      return {
        reset: () => {
          desktopSidebar.setOpenByDefault(
            DEFAULT_SIDEBAR_PREFERENCES.openByDefault,
          )
          desktopSidebar.setWidth(DEFAULT_SIDEBAR_PREFERENCES.defaultWidth)
          for (const descriptor of desktopSidebar.getTabs()) {
            desktopSidebar.setTabEnabled(descriptor.id, true)
          }
          for (const descriptor of desktopSidebar.getViewers()) {
            desktopSidebar.setViewerEnabled(descriptor.id, true)
          }
          void runtimeSettings.reset()
        },
        setOpenByDefault: open => { desktopSidebar.setOpenByDefault(open) },
        setTabEnabled: (id, enabled) => {
          desktopSidebar.setTabEnabled(id, enabled)
        },
        setViewerEnabled: (id, enabled) => {
          desktopSidebar.setViewerEnabled(id, enabled)
        },
        setWidth: width => { desktopSidebar.setWidth(width) },
        runtime: runtimeSettings,
        sidebar: desktopSidebar,
      }
    },
    label: () => t('settings.title'),
    locale: 'oh-dsh.sidebar',
    name: 'settings.section',
    order: 40,
    store: settingsStore,
  }, SidebarSettingsRow))
}

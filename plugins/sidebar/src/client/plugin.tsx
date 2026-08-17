/**
 * Desktop sidebar client plugin assembly.
 *
 * Keeps only the service orchestration: wiring the registry service, the
 * built-in registrations, the settings section, the interception layer and
 * the center-surface host. The panel shell, the workspace tools service,
 * the built-in tab/viewer/surface registrations and the shared client
 * types live in their own modules:
 *   - workspace-tools.ts        — WorkspaceToolsService (panel orchestration)
 *   - SideToolsPanel.tsx        — the right panel shell (tabs / menu / files)
 *   - builtins/                 — the built-in tabs / viewers / surfaces
 *   - settings.tsx              — SidebarSettingsRow + sync
 *   - intercept.ts              — openPath + link interception (registry-based)
 *   - contract.ts               — the public registry protocol
 */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { DesktopPanels } from '../../../panel-controls/src/client.ts'
import type { PinnedSummary } from '../../../pinned-summary/src/client.ts'
import type { LocaleService, Translate } from '@oh-dsh/shared/i18n'
import { isUnderRoot } from '@oh-dsh/shared/path'
import { WORKSPACE_MESSAGES, type WorkspaceMessage } from './i18n.ts'
import { CenterSurfaceHost } from './surfaces/center-surface-host.tsx'
import { WorkspaceToolsService } from './workspace-tools.tsx'
import { DesktopSidebarService } from './sidebar-service.ts'
import { LocalStorageSidebarPreferencesStorage } from './sidebar-storage.ts'
import { DEFAULT_SIDEBAR_PREFERENCES } from '../sidebar-preferences.ts'
import {
  ReviewCommentsService,
  type ReviewInputTriggersService,
} from './review/review-comments.ts'
import { SidebarRuntimeSettingsService } from './runtime-settings.ts'
import type {
  BoundSidebarSettingsActions,
  ClientContext,
  SessionsService,
  SidebarSettingsState,
  SlotsService,
  WorkspacesService,
} from './client-types.ts'
import { registerBuiltins } from './builtins/index.ts'
import { SidebarSettingsRow, syncSidebarSettings } from './settings.tsx'
import { disposeSidebarRuntimes } from './runtimes/registry.ts'
import { acquireOpenPathPatch, isLinkProtocolIntercepted, registerLinkHandler, registerLinkInterception, registerOpenPathHandler, releaseOpenPathPatch } from './intercept.ts'
import { registerImeGuard } from './ime-guard.ts'
import { registerPierreVisibilityRecovery } from './pierre-visibility.ts'

export const inject = [
  'desktopPanels',
  'locale',
  'pinnedSummary',
  'sessions',
  'inputTriggers',
  'slots',
  'workspaces',
]

function activeWorkspace(sessions: SessionsService): string | undefined {
  const snapshot = sessions.list.getSnapshot()
  return snapshot.current === undefined
    ? undefined
    : snapshot.byId[snapshot.current]?.cwd
}

function pathBelongsToActiveWorkspace(
  sessions: SessionsService,
  path: string,
): boolean {
  const cwd = activeWorkspace(sessions)
  if (cwd === undefined) return false
  return isUnderRoot(cwd, path)
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
  const unregisterBuiltins = registerBuiltins(desktopSidebar, {
    openExternalPath,
    panels,
    reviewComments,
    runtimeSettings,
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
      pluginSettings: {},
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
        pluginSettings: Record<string, Record<string, unknown>>,
      ) => {
        if (revision < draft.revision) return
        draft.openByDefault = openByDefault
        draft.revision = revision
        draft.tabsEnabled = tabsEnabled
        draft.viewersEnabled = viewersEnabled
        draft.pluginSettings = pluginSettings
        draft.width = width
      },
    },
  })
  let settingsActions: BoundSidebarSettingsActions | undefined
  ctx.effect(() => {
    const syncSession = (): void => {
      const list = sessions.list.getSnapshot()
      const current = list.current ?? null
      desktopSidebar.setSession(
        current,
        current === null ? undefined : list.byId[current]?.cwd,
      )
    }
    syncSession()
    const stopSessions = sessions.list.subscribe(syncSession)
    const stopSettings = desktopSidebar.subscribe(() => {
      syncSidebarSettings(settingsActions, desktopSidebar.getSnapshot())
    })
    const syncRuntime = (): void => {
      const prefs = runtimeSettings.getSnapshot().preferences
      panels.setAutoOpenTerminal(prefs.bottomPanelAutoTerminal)
      panels.setTerminalFontPreferences(prefs.terminalFontFamily, prefs.terminalFontSize)
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
    // same-origin links always bypass). A plugin urlTarget claim wins; the
    // built-in browser tab is the implicit fallback target.
    const stopLink = registerLinkHandler((url): boolean => {
      const runtime = runtimeSettings.getSnapshot().preferences
      const snapshot = desktopSidebar.getSnapshot()
      if (!runtime.browserInterceptLinks || !snapshot.ready) return false
      // Per-protocol gate: the http/https flags sit between the master
      // switch and the urlTarget claims, so a claimed target is only opened
      // when its protocol is eligible too (upstream `browserInterceptHttp` /
      // `browserInterceptHttps` semantics).
      if (!isLinkProtocolIntercepted(url.protocol, {
        browserInterceptHttp: runtime.browserInterceptHttp,
        browserInterceptHttps: runtime.browserInterceptHttps,
      })) return false
      const claimed = desktopSidebar.resolveUrlTarget(url)
      if (claimed !== undefined) {
        if (!desktopSidebar.isTabEnabled(claimed.id)) return false
        let title: string | undefined
        try { title = url.hostname } catch { /* keep the default title */ }
        desktopSidebar.openTab({
          type: claimed.id,
          resource: url.href,
          ...(title === undefined ? {} : { title }),
        })
        desktopSidebar.setOpen(true)
        return true
      }
      if (!desktopSidebar.isTabEnabled('browser')) return false
      service.openBrowserUrl(url.href)
      return true
    })
    acquireOpenPathPatch(workspaces)
    const stopLinkDom = registerLinkInterception()
    // IME-composition guard: document capture phase, before React delegation
    // and any inlined third-party component (the HTML preview's iframe), so
    // composition keys keep their IME meaning (see ime-guard.ts).
    const stopImeGuard = registerImeGuard()
    // Pierre's rAF-driven render loop pauses while the window is hidden;
    // re-queue window builds when the app returns to the foreground.
    const stopPierreVisibility = registerPierreVisibilityRecovery()
    syncRuntime()
    void runtimeSettings.start()
    void desktopSidebar.start()
    service.mount()
    // Center surface module: renders through the service's surface-renderer
    // registry (built-ins registered by registerBuiltins above).
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
      stopImeGuard()
      stopPierreVisibility()
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
        updatePluginSetting: (id, key, value) => {
          desktopSidebar.updatePluginSetting(id, key, value)
        },
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

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
 *   - intercept.ts              — the official open hook (openPath takeover
 *                                 + external-link claims), owned by the open
 *                                 pipeline
 *   - contract.ts               — the public registry protocol
 */
import type { PinnedSummary } from '@dsh-studio/pinned-summary/client'
import type { LocaleService, Translate } from '@dsh-studio/shared/i18n'
import { basename, isUnderRoot } from '@dsh-studio/shared/path'
import type {
  LayoutService,
  OpenPipeline,
  SurfaceRegistry,
  WorkspaceEventsService,
} from '@dsh-studio/shared/workbench-contracts'
import { forwardSessionIdentity } from '@dsh-studio/shared/workbench-contracts'
import { connectOpenPipeline, workbenchOpen } from './open/pipeline.ts'
import { WORKSPACE_MESSAGES, type WorkspaceMessage } from './i18n.ts'
import { CenterSurfaceHost } from './surfaces/center-surface-host.tsx'
import { WorkspaceToolsService, activeWorkspace } from './workspace-tools.tsx'
import { DesktopSidebarService } from './sidebar-service.ts'
import { DomainSidebarPreferencesStorage } from './sidebar-storage.ts'
import { DEFAULT_SIDEBAR_PREFERENCES } from '../sidebar-preferences.ts'
import {
  ReviewCommentsService,
  type ReviewInputTriggersService,
} from './review/review-comments.ts'
import { createSelectionSlashSource } from './selection/slash-source.ts'
import { SidebarRuntimeSettingsService, DEFAULT_SIDEBAR_RUNTIME_PREFERENCES } from './runtime-settings.ts'
import type {
  BoundSidebarSettingsActions,
  ClientContext,
  SessionsService,
  SlotsService,
  WorkspacesService,
} from './client-types.ts'
import { registerBuiltins } from './builtins/index.ts'
import { disposeAllTerminalRuntimeOwners } from '@dsh-studio/shared/terminal-runtime-owner'
import { SidebarSettingsRow } from './settings.tsx'
import { AgentCapabilitiesSettingsSection } from './settings-agent.tsx'
import { disposeSidebarRuntimes, invalidateRetainedRuntimes } from './runtimes/registry.ts'
import { installOfficialOpenHook, isLinkProtocolIntercepted } from './intercept.ts'
import { registerImeGuard } from './ime-guard.ts'
import { registerPierreVisibilityRecovery } from './pierre-visibility.ts'
import { startSidebarChromePersistence } from './runtimes/chrome-store.ts'
import { startDiffCommentsPersistence } from './diff/diff-comments-store.ts'
import { migrateLegacyCommentsIntoDomain } from '@dsh-studio/shared/comments-migration'
import { snapshotStoreAdapter } from './snapshot-store-adapter.ts'
import type { SidebarSnapshot } from './contract.ts'
import type { SidebarSettingsState } from './client-types.ts'

export const inject = [
  'locale',
  'pinnedSummary',
  'sessions',
  'inputTriggers',
  'slots',
  'workspaces',
]

// `activeWorkspace` (the cwd derivation single source) is exported from
// workspace-tools.tsx and reused here (F5: no inline copies).

function pathBelongsToActiveWorkspace(
  sessions: SessionsService,
  path: string,
): boolean {
  const cwd = activeWorkspace(sessions)
  if (cwd === undefined) return false
  return isUnderRoot(cwd, path)
}

/** The fields the settings section mirrors from the sidebar snapshot (F6). */
function pickSidebarSettings(snapshot: SidebarSnapshot): SidebarSettingsState {
  return {
    openByDefault: snapshot.openByDefault,
    revision: snapshot.revision,
    tabsEnabled: { ...snapshot.tabsEnabled },
    viewersEnabled: { ...snapshot.viewersEnabled },
    width: snapshot.width,
    pluginSettings: snapshot.pluginSettings,
  }
}

export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  const slots = ctx.get('slots') as SlotsService
  const t: Translate<WorkspaceMessage> = locale.bind('dsh-studio.sidebar')
  ctx.effect(
    () => locale.register('dsh-studio.sidebar', WORKSPACE_MESSAGES),
    'dsh-studio: workspace tools dictionaries',
  )
  // The right panel's footprint negotiates through the workbench kernel's
  // LayoutService (leaf-1.6): panel consumers no longer need a coordinator.
  const layout = ctx.get('workbench.layout') as LayoutService
  const events = ctx.get('workbench.events') as WorkspaceEventsService
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
    ctx.get('workbench.events') as WorkspaceEventsService,
  )
  // Register the selection slash source so `slash/input-insert-reference`
  // accepts `dsh-studio-selection` chips (without registration the composer
  // fails the send with "slash no ...").
  ctx.effect(
    () => inputTriggers.registerSource(createSelectionSlashSource()),
    'dsh-studio: selection slash source',
  )
  const runtimeSettings = new SidebarRuntimeSettingsService()
  const workbenchRegistry = ctx.get('workbench.registry') as SurfaceRegistry
  const desktopSidebar = new DesktopSidebarService(
    new DomainSidebarPreferencesStorage(),
    featureEnablement => { void runtimeSettings.update(featureEnablement) },
    workbenchRegistry,
  )
  const service = new WorkspaceToolsService(
    desktopSidebar,
    layout,
    locale,
    t,
    pinnedSummary,
    sessions,
    workspaces,
  )
  // The open pipeline: every sidebar open funnels through the workbench
  // kernel's `workbench.open` service; built-ins have already projected their
  // descriptors into the same kernel registry before its dispatcher connects.
  const kernelOpen = ctx.get('workbench.open') as OpenPipeline
  const unregisterBuiltins = registerBuiltins(desktopSidebar, {
    openExternalPath,
    reviewComments,
    runtimeSettings,
    service,
    sessions,
    sidebar: desktopSidebar,
    t,
    workspaces,
  })
  const disposeOpenPipeline = connectOpenPipeline({
    open: kernelOpen,
    sidebar: desktopSidebar,
  })
  // The settings store is a LIVE derived view of the sidebar snapshot (F6).
  // snapshotStoreAdapter supplies a `sync` action that replaces the draft
  // with `pickSidebarSettings(snapshot)`; the sidebar subscription below
  // fires it (the framework re-delivers the bound action to `inject`).
  const settingsStore = snapshotStoreAdapter(desktopSidebar, pickSidebarSettings)
  let settingsActions: BoundSidebarSettingsActions | undefined
  ctx.effect(() => {
    const stopChrome = startSidebarChromePersistence()
    // Comments: migrate the legacy localStorage keys into the domain table
    // once, then hydrate both comment families from it (F1/F2/M7).
    const stopDiffComments = startDiffCommentsPersistence()
    void migrateLegacyCommentsIntoDomain().then(() => reviewComments.start())
    const syncWorkspace = (): void => {
      // The current project = the active session's cwd, falling back to any
      // valid workspace cwd in the session roster.
      const cwd = activeWorkspace(sessions) ?? null
      desktopSidebar.setWorkspace(cwd)
    }
    syncWorkspace()
    // Switching awareness funnels through the kernel events service
    // (leaf-1.7): ONE identity pump feeds `workbench.events` from the
    // runtime's current-session projection, and every consumer reacts to the
    // two identity events instead of subscribing to the roster itself.
    const stopIdentity = forwardSessionIdentity(
      events,
      sessions.currentProvideInfo,
      () => activeWorkspace(sessions),
    )
    const stopWorkspaceEvents = events.onWorkspaceChanged(() => { syncWorkspace() })
    const stopSessionEvents = events.onSessionChanged(() => { syncWorkspace() })
    // Retained runtimes key their caches by cwd; a workspace switch evicts
    // them so returning to a project rebuilds with fresh data (live terminal
    // instances are session-owned and survive).
    const stopRuntimeInvalidation = events.onWorkspaceChanged(() => {
      invalidateRetainedRuntimes()
    })
    // Push the picked sidebar settings into the slots settings store once the
    // framework has bound the store's `sync` action to inject().
    const syncSettings = (): void => {
      settingsActions?.sync(pickSidebarSettings(desktopSidebar.getSnapshot()))
    }
    const stopSettings = desktopSidebar.subscribe(syncSettings)
    const syncRuntime = (): void => {
      const prefs = runtimeSettings.getSnapshot().preferences
      desktopSidebar.setFeatureEnablement(prefs.tabsEnabled, prefs.viewersEnabled)
      // The bottom-mounted terminal dock no longer mounts
      // (plugins/panel-controls), so there is nothing to sync; the terminal
      // prefs are consumed by the terminal tab renderers directly.
    }
    const stopRuntime = runtimeSettings.subscribe(syncRuntime)
    // The official open hook (openPath takeover + external-link claims) is
    // owned by the open pipeline: one refcounted patch per workspaces
    // service, HMR-idempotent; this activation registers its claims only.
    const officialOpenHook = installOfficialOpenHook(workspaces)
    const stopOpenPath = officialOpenHook.onOpenPath(async (path): Promise<boolean> => {
      const runtime = runtimeSettings.getSnapshot().preferences
      const snapshot = desktopSidebar.getSnapshot()
      if (!(runtime.interceptOpenPath
        && snapshot.ready
        && desktopSidebar.isTabEnabled('file')
        && pathBelongsToActiveWorkspace(sessions, path))) return false
      const cwd = activeWorkspace(sessions)
      if (cwd === undefined) return false
      // Where a captured path lands is a preference: the CENTER tab strip (a
      // replaceable preview, interaction-model D2) or the RIGHT rail file tab
      // (historical behavior). Both are real open lives — only the location
      // differs; the cwd the path was validated against is the active one.
      if (runtime.pathOpenArea === 'rail') {
        service.openFile(path)
        return true
      }
      workbenchOpen().open({
        kind: 'file',
        target: { cwd, path },
        intent: 'preview',
        title: basename(path),
      })
      return true
    })
    // External-link claims through the hook's link table (Ctrl/Cmd+click and
    // same-origin links always bypass). A plugin urlTarget claim wins; the
    // built-in browser tab is the implicit fallback target.
    const stopLink = officialOpenHook.onLink((url): boolean => {
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
        if (!desktopSidebar.isTabEnabled(claimed.kind)) return false
        let title: string | undefined
        try { title = url.hostname } catch { /* keep the default title */ }
        desktopSidebar.openTab({
          type: claimed.kind,
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
    const stopImeGuard = registerImeGuard()
    // Pierre's rAF-driven render loop pauses while the window is hidden;
    // re-queue window builds when the app returns to the foreground.
    const stopPierreVisibility = registerPierreVisibilityRecovery()
    syncRuntime()
    void runtimeSettings.start()
    void desktopSidebar.start()
    service.mount()
    // Center surface module: renders through the unified descriptor table
    // (built-ins registered by registerBuiltins above).
    const centerSurfaceHost = new CenterSurfaceHost({
      sessions,
      t,
      sidebar: desktopSidebar,
      workspaces,
      layout,
    })
    centerSurfaceHost.mount()
    const removeSidebar = ctx.reflect.provide(
      'desktopSidebar',
      desktopSidebar,
      undefined,
    )
    const removeService = ctx.reflect.provide('workspaceTools', service, undefined)
    return () => {
      stopIdentity()
      stopWorkspaceEvents()
      stopSessionEvents()
      stopRuntimeInvalidation()
      stopSettings()
      stopRuntime()
      stopOpenPath()
      stopLink()
      officialOpenHook.dispose()
      stopImeGuard()
      stopPierreVisibility()
      centerSurfaceHost.dispose()
      service.dispose()
      unregisterBuiltins()
      disposeOpenPipeline()
      reviewComments.dispose()
      desktopSidebar.dispose()
      runtimeSettings.dispose()
      stopChrome()
      stopDiffComments()
      disposeAllTerminalRuntimeOwners()
      disposeSidebarRuntimes()
      void removeSidebar?.()
      void removeService?.()
    }
  }, 'dsh-studio: workspace tools')

  slots.inject('settings.section', () => slots.register({
    id: 'dsh-studio-sidebar',
    inject: actions => {
      settingsActions = actions
      settingsActions.sync(pickSidebarSettings(desktopSidebar.getSnapshot()))
      return {
        // Page-scoped reset: the Side panel page owns layout and opening
        // behavior; agent capabilities reset on their own page
        // (dsh-studio-agent) and feature detail rows keep their values.
        reset: () => {
          desktopSidebar.setOpenByDefault(
            DEFAULT_SIDEBAR_PREFERENCES.openByDefault,
          )
          desktopSidebar.setWidth(DEFAULT_SIDEBAR_PREFERENCES.defaultWidth)
          void runtimeSettings.update({
            tabsEnabled: {},
            viewersEnabled: {},
            interceptOpenPath: DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.interceptOpenPath,
            pathOpenArea: DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.pathOpenArea,
            browserInterceptLinks: DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.browserInterceptLinks,
            browserInterceptHttp: DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.browserInterceptHttp,
            browserInterceptHttps: DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.browserInterceptHttps,
            htmlViewerNoSandbox: DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.htmlViewerNoSandbox,
            htmlViewerDefaultUnsafe: DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.htmlViewerDefaultUnsafe,
            autoOpenSubagent: DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.autoOpenSubagent,
            autoOpenJobs: DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.autoOpenJobs,
          })
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
    locale: 'dsh-studio.sidebar',
    name: 'settings.section',
    order: 40,
    store: settingsStore,
  }, SidebarSettingsRow))

  // The Agent capabilities page: model-facing capability switches and the
  // Source Control AI entry, slotted between the official sections (20) and
  // the Side panel page (40). Its store is trivial (no localStorage-backed
  // per-section state), so no `store` registration is needed.
  slots.inject('settings.section', () => slots.register({
    id: 'dsh-studio-agent',
    inject: () => ({
      runtime: runtimeSettings,
      t,
      reset: () => {
        void runtimeSettings.update({
          agentTerminalTools: false,
          agentWorktreeTools: false,
          agentWorktreeDelegationTools: false,
        })
      },
    }),
    label: () => t('settings.agent-capabilities'),
    locale: 'dsh-studio.sidebar',
    name: 'settings.section',
    order: 30,
  }, AgentCapabilitiesSettingsSection))
}

/** Browser face for the native DSH Studio bridge. */

import type { DesktopBridge, DesktopCommand } from './contracts.ts'
import type { DesktopPanels } from '@dsh-studio/panel-controls/client'
import type { PinnedSummary } from '@dsh-studio/pinned-summary/client'
import type { WorkspaceTools } from '@dsh-studio/sidebar/client/types'
import type {
  LocaleMessages,
  LocaleService,
  Translate,
} from '@dsh-studio/shared/i18n'
import {
  DSH_STUDIO_SURFACE_VIEW_SERVICE,
  type DshStudioSurfaceView,
} from '@dsh-studio/shared/surface'
// The desktop chrome stylesheet and its installer live in desktop-chrome.ts.
import { installDesktopChrome } from './desktop-chrome.ts'
// The desktop shell has no DOM probes of its own; opening upstream Settings
// goes through the sidebar plugin's single legal probe module
// (plugins/AGENTS.md "Upstream DOM probes"), the same file that pins the
// left-rail toggle labels.
import { settingsTriggerButton } from '../plugins/sidebar/src/client/surfaces/dsh-dom.ts'

interface WorkspaceView {
  workspaceId: string
}

interface WorkspacesService {
  create(input: { path: string }): Promise<WorkspaceView>
  startSession(workspaceId?: string): void
}

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: { provide(name: string, value: unknown, options?: unknown): void }
}

declare global {
  interface Window {
    dshDesktop?: DesktopBridge
  }
}

/** Wait for the DSH services used by native menu commands. */
export const inject = ['locale', 'workspaces', 'desktopPanels', 'pinnedSummary', 'workspaceTools']

type DesktopShellMessage = 'preview.label'

const DESKTOP_SHELL_MESSAGES: LocaleMessages<DesktopShellMessage> = {
  en: {
    'preview.label': 'Isolated plugin preview · {plugin}',
  },
  zh: {
    'preview.label': '隔离插件预览 · {plugin}',
  },
}

function focusComposer(): void {
  document.querySelector<HTMLTextAreaElement>('textarea')?.focus()
}

async function openPaths(workspaces: WorkspacesService, paths: readonly string[]): Promise<void> {
  for (const path of paths) {
    const workspace = await workspaces.create({ path })
    workspaces.startSession(workspace.workspaceId)
  }
}

function dispatch(
  command: DesktopCommand,
  workspaces: WorkspacesService,
  panels: DesktopPanels,
  pinnedSummary: PinnedSummary,
  workspaceTools: WorkspaceTools,
): void {
  switch (command.type) {
    case 'focus-composer':
      focusComposer()
      return
    case 'new-session':
      workspaces.startSession()
      return
    case 'open-paths':
      void openPaths(workspaces, command.paths).catch((error: unknown) => {
        console.error('dsh-studio: failed to open workspace', error)
      })
      return
    case 'show-settings':
      settingsTriggerButton()?.click()
      return
    case 'toggle-sidebar':
      panels.toggleSidebar()
      return
    case 'toggle-panel-maximized':
      workspaceTools.togglePanelMaximized()
      return
    case 'toggle-pinned-summary':
      workspaceTools.setOpen(false)
      pinnedSummary.toggle()
      return
    case 'toggle-workspace-panel':
      workspaceTools.toggle()
      return
    case 'toggle-side-panel':
      workspaceTools.toggleSidePanel()
      return
    case 'open-browser':
      workspaceTools.openBrowser()
      return
    case 'open-files':
      workspaceTools.openFiles()
      return
    case 'open-review':
      workspaceTools.openReview()
      return
    case 'open-side-chat':
      void workspaceTools.openSideChat().catch((error: unknown) => {
        console.error('dsh-studio: failed to open side chat', error)
      })
      return
    case 'open-trajectory':
      workspaceTools.openTrajectory()
      return
    default:
      command satisfies never
  }
}

/** Enroll the isolated Electron bridge and map native actions to DSH services. */
export function apply(ctx: ClientContext): void {
  const bridge = window.dshDesktop
  if (bridge === undefined) {
    throw new Error('dsh-studio: preload bridge is unavailable outside DSH Studio')
  }
  const workspaces = ctx.get('workspaces') as WorkspacesService
  const locale = ctx.get('locale') as LocaleService
  const t: Translate<DesktopShellMessage> = locale.bind('dsh-studio.desktop')
  const panels = ctx.get('desktopPanels') as DesktopPanels
  const pinnedSummary = ctx.get('pinnedSummary') as PinnedSummary
  const workspaceTools = ctx.get('workspaceTools') as WorkspaceTools
  ctx.effect(
    () => locale.register('dsh-studio.desktop', DESKTOP_SHELL_MESSAGES),
    'dsh-studio: shell dictionaries',
  )
  ctx.reflect.provide('desktopShell', bridge, undefined)
  // The unified three-surface contract, client plane: the desktop shell.
  ctx.reflect.provide(DSH_STUDIO_SURFACE_VIEW_SERVICE, Object.freeze({
    kind: 'desktop',
  } satisfies DshStudioSurfaceView), undefined)
  ctx.effect(() => {
    let disposed = false
    let previewPluginId: string | null = null
    const renderPreviewLabel = (): void => {
      if (previewPluginId === null) return
      document.body.dataset.dshStudioPreviewLabel = t('preview.label', {
        plugin: previewPluginId,
      })
    }
    const removeDesktopChrome = installDesktopChrome()
    const unsubscribeLocale = locale.subscribe(renderPreviewLabel)
    void bridge.getInfo().then(info => {
      if (disposed || info.preview === null) return
      previewPluginId = info.preview.pluginId
      document.documentElement.dataset.dshStudioPreview = 'true'
      renderPreviewLabel()
    }).catch((error: unknown) => {
      console.error('dsh-studio: failed to read preview identity', error)
    })
    const unsubscribe = bridge.onCommand((command) => {
      dispatch(command, workspaces, panels, pinnedSummary, workspaceTools)
    })
    return () => {
      disposed = true
      unsubscribe()
      unsubscribeLocale()
      removeDesktopChrome()
      delete document.documentElement.dataset.dshStudioPreview
      delete document.body.dataset.dshStudioPreviewLabel
    }
  }, 'dsh-studio: native command bridge')
}

/** Browser face for the native Oh-DSH-Desktop bridge. */

import type { DesktopBridge, DesktopCommand } from './contracts.ts'
import type { DesktopPanels } from '../plugins/panel-controls/src/client.ts'
import type { PinnedSummary } from '../plugins/pinned-summary/src/client.ts'
import type { WorkspaceTools } from '../plugins/desktop-sidebar/src/client.ts'
import type {
  LocaleMessages,
  LocaleService,
  Translate,
} from '../plugins/shared/i18n.ts'

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

/**
 * Height of the window's top drag strip. 0: there is no strip — the DSH
 * conversation header is the drag region (see the CSS below), so no white
 * bar remains above the content. `--oh-dsh-titlebar-height` is kept as a 0px
 * token so plugins that reference it (marketplace surface, pinned summary,
 * panel toolbar) follow the removal automatically.
 */
const DESKTOP_TITLEBAR_HEIGHT = 0

const DESKTOP_CHROME_CSS = `
html[data-oh-dsh-desktop='true'] {
  /* Titlebar inset token — the renderer equivalent of the reference
     desktop distribution's --dsh-desktop-titlebar-inset. Plugins read this
     to keep their surfaces flush with the top edge. */
  --oh-dsh-titlebar-height: ${DESKTOP_TITLEBAR_HEIGHT}px;
}

html[data-oh-dsh-desktop='true'] body {
  box-sizing: border-box;
}

/* No top drag strip: the DSH conversation header is the drag region. It
   stays pinned at the top of the center column (it lives outside the
   scrollable conversation body), so the window can always be dragged by it.
   The header's interactive controls are re-enabled below. */
html[data-oh-dsh-desktop='true'] [data-slot='conversation'] header {
  -webkit-app-region: drag;
  user-select: none;
}

html[data-oh-dsh-desktop='true'] [data-slot='conversation'] header button,
html[data-oh-dsh-desktop='true'] [data-slot='conversation'] header a,
html[data-oh-dsh-desktop='true'] [data-slot='conversation'] header input,
html[data-oh-dsh-desktop='true'] [data-slot='conversation'] header select,
html[data-oh-dsh-desktop='true'] [data-slot='conversation'] header textarea,
html[data-oh-dsh-desktop='true'] [data-slot='conversation'] header [role='button'],
html[data-oh-dsh-desktop='true'] [data-slot='conversation'] header [role='link'],
html[data-oh-dsh-desktop='true'] [data-slot='conversation'] header [role='tab'],
html[data-oh-dsh-desktop='true'] [data-slot='conversation'] header [contenteditable='true'] {
  -webkit-app-region: no-drag;
  user-select: auto;
}

/* Electron drag regions ignore visual stacking: while a modal is mounted,
   suspend every renderer-owned drag target so the mask and the modal's own
   controls keep pointer input (same rule as the reference desktop
   distribution). Restoring the final modal re-enables the regions. */
html[data-oh-dsh-desktop='true']:has([aria-modal='true']) body * {
  -webkit-app-region: no-drag;
}

/* Fallback: if no usable conversation header exists (empty state, other
   views, or a session with no messages yet — DSH hides the header via the
   headerHidden class and unloads its content), an invisible 28px strip keeps
   the window draggable. Invisible on purpose — the visible white bar is
   gone for good. A non-empty header (the normal session view) disables it. */
html[data-oh-dsh-desktop='true'] body:not(:has([data-slot='conversation'] header:not(:empty)))::before {
  content: '';
  position: fixed;
  z-index: 2147483647;
  top: 0;
  right: 0;
  left: 0;
  height: 28px;
  -webkit-app-region: drag;
}

/* The macOS traffic lights live in the window's top-left corner (~28px);
   keep them clear of the sidebar rail's top button row. The strip itself is
   not draggable (the header is), which is fine — the traffic lights sit
   there anyway. */
html[data-oh-dsh-desktop='true'] [data-slot='sidebar'] > div {
  padding-top: 28px;
}

html[data-oh-dsh-preview='true'] body::after {
  content: attr(data-oh-dsh-preview-label);
  position: fixed;
  z-index: 2147483647;
  top: 7px;
  left: 50%;
  max-width: 52vw;
  padding: 4px 11px;
  overflow: hidden;
  border: 1px solid #a9c2f5;
  border-radius: 999px;
  background: #edf3ff;
  color: #28549f;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  pointer-events: none;
  text-overflow: ellipsis;
  transform: translateX(-50%);
  white-space: nowrap;
}

html[data-oh-dsh-desktop='true'] #root:has(
  [role='presentation'] > [role='dialog']
) {
  z-index: 1000 !important;
  overflow: visible !important;
}

html[data-oh-dsh-desktop='true'] #root [role='presentation']:has(
  > [role='dialog']
) {
  z-index: 1000 !important;
  background: rgb(0 0 0 / 22%) !important;
  -webkit-backdrop-filter: blur(6px) saturate(0.9);
  backdrop-filter: blur(6px) saturate(0.9);
}

html[data-oh-dsh-desktop='true']:has(
  #root [role='presentation'] > [role='dialog']
) body::after,
html[data-oh-dsh-desktop='true']:has(
  #root [role='presentation'] > [role='dialog']
) #oh-dsh-desktop-sidebar-root,
html[data-oh-dsh-desktop='true']:has(
  #root [role='presentation'] > [role='dialog']
) [data-oh-dsh-pinned-summary],
html[data-oh-dsh-desktop='true']:has(
  #root [role='presentation'] > [role='dialog']
) #oh-dsh-plugin-marketplace-root {
  z-index: 999 !important;
}

html[data-oh-dsh-desktop='true']:has(
  #root [role='presentation'] > [role='dialog']
) #oh-dsh-plugin-marketplace-root {
  position: relative;
}

`

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

function installDesktopChrome(): () => void {
  const originalTitle = document.title
  const style = document.createElement('style')
  style.dataset.ohDshDesktopChrome = 'true'
  style.textContent = DESKTOP_CHROME_CSS
  document.head.append(style)
  document.documentElement.dataset.ohDshDesktop = 'true'
  document.title = 'Oh-DSH-Desktop'
  return () => {
    style.remove()
    delete document.documentElement.dataset.ohDshDesktop
    document.title = originalTitle
  }
}

function installHeroBranding(): () => void {
  const headlineCopy = new Set(['Into the Unknown', '探索未知之境'])
  const originalHeadlines = new Map<HTMLElement, string>()
  const synchronize = (): void => {
    for (const element of document.querySelectorAll<HTMLElement>('span')) {
      const text = element.textContent?.trim() ?? ''
      if (!headlineCopy.has(text)) continue
      if (!originalHeadlines.has(element)) originalHeadlines.set(element, text)
      element.textContent = 'Oh-DSH-Desktop'
      element.dataset.ohDshHeroHeadline = 'true'
    }
  }
  const observer = new MutationObserver(synchronize)
  observer.observe(document.body, { childList: true, characterData: true, subtree: true })
  synchronize()
  return () => {
    observer.disconnect()
    for (const [element, original] of originalHeadlines) {
      if (element.isConnected && element.textContent === 'Oh-DSH-Desktop') element.textContent = original
      delete element.dataset.ohDshHeroHeadline
    }
  }
}

function focusComposer(): void {
  document.querySelector<HTMLTextAreaElement>('textarea')?.focus()
}

function showSettings(): void {
  document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click()
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
        console.error('oh-dsh-desktop: failed to open workspace', error)
      })
      return
    case 'show-settings':
      showSettings()
      return
    case 'toggle-sidebar':
      panels.toggleSidebar()
      return
    case 'toggle-bottom-panel':
      panels.toggleBottomPanel()
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
        console.error('oh-dsh-desktop: failed to open side chat', error)
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
    throw new Error('oh-dsh-desktop: preload bridge is unavailable outside Oh-DSH-Desktop')
  }
  const workspaces = ctx.get('workspaces') as WorkspacesService
  const locale = ctx.get('locale') as LocaleService
  const t: Translate<DesktopShellMessage> = locale.bind('oh-dsh.desktop')
  const panels = ctx.get('desktopPanels') as DesktopPanels
  const pinnedSummary = ctx.get('pinnedSummary') as PinnedSummary
  const workspaceTools = ctx.get('workspaceTools') as WorkspaceTools
  ctx.effect(
    () => locale.register('oh-dsh.desktop', DESKTOP_SHELL_MESSAGES),
    'oh-dsh-desktop: shell dictionaries',
  )
  ctx.reflect.provide('desktopShell', bridge, undefined)
  ctx.effect(() => {
    let disposed = false
    let previewPluginId: string | null = null
    const renderPreviewLabel = (): void => {
      if (previewPluginId === null) return
      document.body.dataset.ohDshPreviewLabel = t('preview.label', {
        plugin: previewPluginId,
      })
    }
    const removeDesktopChrome = installDesktopChrome()
    const removeHeroBranding = installHeroBranding()
    const unsubscribeLocale = locale.subscribe(renderPreviewLabel)
    void bridge.getInfo().then(info => {
      if (disposed || info.preview === null) return
      previewPluginId = info.preview.pluginId
      document.documentElement.dataset.ohDshPreview = 'true'
      renderPreviewLabel()
    }).catch((error: unknown) => {
      console.error('oh-dsh-desktop: failed to read preview identity', error)
    })
    const unsubscribe = bridge.onCommand((command) => {
      dispatch(command, workspaces, panels, pinnedSummary, workspaceTools)
    })
    return () => {
      disposed = true
      unsubscribe()
      unsubscribeLocale()
      removeHeroBranding()
      removeDesktopChrome()
      delete document.documentElement.dataset.ohDshPreview
      delete document.body.dataset.ohDshPreviewLabel
    }
  }, 'oh-dsh-desktop: native command bridge')
}

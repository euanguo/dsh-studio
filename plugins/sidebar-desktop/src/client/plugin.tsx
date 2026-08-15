import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import type { DesktopSidebar } from '../../../sidebar/src/client/sidebar-service.ts'
import type { WorkspaceMessage } from '../../../sidebar/src/client/i18n.ts'
import { ToolIcon } from '../../../sidebar/src/client/SideToolsPanel.tsx'
import { centerSurfaceRendererRegistry } from '../../../sidebar/src/client/surfaces/center-surface-host.tsx'
import { BrowserView, BrowserSurfaceView } from './browser-view.tsx'

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
}

export const inject = ['desktopSidebar', 'locale']

/**
 * Desktop add-on: registers the Electron `<webview>` browser as a sidebar tab
 * and as a center-surface renderer. The generic sidebar deliberately ships
 * WITHOUT these so it stays Electron-free; this plugin is what a desktop
 * distribution layers on top.
 */
export function apply(ctx: ClientContext): void {
  const sidebar = ctx.get('desktopSidebar') as DesktopSidebar
  const locale = ctx.get('locale') as LocaleService
  // Reuse the generic sidebar's dictionary namespace so the browser.* keys
  // resolve without duplicating them here.
  const t: Translate<WorkspaceMessage> = locale.bind('oh-dsh.sidebar')

  ctx.effect(() => {
    const removeTab = sidebar.registerTab({
      icon: <ToolIcon kind="browser" />,
      id: 'browser',
      order: 30,
      render: props => <BrowserView {...props} t={t} />,
      shortcut: '⌘T',
      title: () => t('browser'),
    })
    centerSurfaceRendererRegistry.register('browser', surface => {
      if (surface.kind !== 'browser') return null
      return <BrowserSurfaceView surface={surface} t={t} />
    })
    return () => {
      removeTab()
    }
  }, 'sidebar-desktop: browser tab + surface renderer')
}

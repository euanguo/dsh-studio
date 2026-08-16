import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import type {
  DesktopSidebarService,
  SidebarRenderProps,
} from '../../../sidebar/src/client/contract.ts'
import type { WorkspaceMessage } from '../../../sidebar/src/client/i18n.ts'
import { ToolIcon } from '../../../sidebar/src/client/SideToolsPanel.tsx'
import type { BrowserCenterSurface } from '../../../sidebar/src/client/surfaces/types.ts'
import { BrowserView, BrowserSurfaceView } from './browser-view.tsx'

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
}

export const inject = ['desktopSidebar', 'locale']

/**
 * Desktop add-on: registers the Electron `<webview>` browser as a sidebar tab
 * and as a center-surface renderer through the registry service's extension
 * points (the same contract external plugins use). The generic sidebar
 * deliberately ships WITHOUT these so it stays Electron-free; this plugin is
 * what a desktop distribution layers on top.
 */
export function apply(ctx: ClientContext): void {
  const sidebar = ctx.get('desktopSidebar') as DesktopSidebarService
  const locale = ctx.get('locale') as LocaleService
  // Reuse the generic sidebar's dictionary namespace so the browser.* keys
  // resolve without duplicating them here.
  const t: Translate<WorkspaceMessage> = locale.bind('oh-dsh.sidebar')

  ctx.effect(() => {
    const removeTab = sidebar.registerTab({
      icon: <ToolIcon kind="browser" />,
      id: 'browser',
      order: 30,
      render: (props: SidebarRenderProps) => <BrowserView {...props} t={t} />,
      shortcut: '⌘T',
      // Declarative settings: the link-takeover MASTER switch renders under
      // this tab's card in the settings page.
      settings: {
        toggles: [{
          key: 'browserInterceptLinks',
          title: () => t('settings.open-links'),
          desc: () => t('settings.open-links-description'),
        }],
      },
      title: () => t('browser'),
    })
    const removeSurface = sidebar.registerSurfaceRenderer('browser', surface => {
      if (surface.kind !== 'browser') return null
      return <BrowserSurfaceView surface={surface as BrowserCenterSurface} t={t} />
    })
    return () => {
      removeTab()
      removeSurface()
    }
  }, 'sidebar-desktop: browser tab + surface renderer')
}

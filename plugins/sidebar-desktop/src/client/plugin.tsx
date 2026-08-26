import type { LocaleService, Translate } from '@dsh-studio/shared/i18n'
import { ToolIcon } from '@dsh-studio/shared/tool-icon'
import type {
  DesktopSidebarService,
  SidebarRenderProps,
} from '@dsh-studio/sidebar/client/contract'
import type { WorkspaceMessage } from '@dsh-studio/sidebar/client/i18n'
import type { BrowserCenterSurface } from '@dsh-studio/sidebar/client/surfaces-types'
import { BrowserView, BrowserSurfaceView } from './browser-view.tsx'
import { clearLiveBrowserUrl } from './browser-runtime.ts'

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
}

export const inject = ['desktopSidebar', 'locale']

/**
 * Desktop add-on: registers the Electron `<webview>` browser as ONE unified
 * sidebar surface — the right-rail tab and the center-workbench renderer
 * hang off the same descriptor, through the same registration external
 * plugins use. The generic sidebar deliberately ships WITHOUT this so it
 * stays Electron-free; this plugin is what a desktop distribution layers on.
 */
export function apply(ctx: ClientContext): void {
  const sidebar = ctx.get('desktopSidebar') as DesktopSidebarService
  const locale = ctx.get('locale') as LocaleService
  // Reuse the generic sidebar's dictionary namespace so the browser.* keys
  // resolve without duplicating them here.
  const t: Translate<WorkspaceMessage> = locale.bind('dsh-studio.sidebar')

  ctx.effect(() => {
    const removeSurface = sidebar.register({
      kind: 'browser',
      rail: {
        icon: <ToolIcon kind="browser" />,
        order: 30,
        render: (props: SidebarRenderProps) => <BrowserView {...props} t={t} />,
        // Frees the retained live URL when the browser tab is closed so the
        // runtime does not leak per-tab entries (see browser-runtime.ts).
        onClose: tab => clearLiveBrowserUrl(tab.id),
        shortcut: '⌘T',
        // Declarative settings: the link-takeover MASTER switch and the two
        // per-protocol flags render under this tab's card in the settings page.
        settings: {
          toggles: [{
            key: 'browserInterceptLinks',
            title: () => t('settings.open-links'),
            desc: () => t('settings.open-links-description'),
          }, {
            key: 'browserInterceptHttp',
            title: () => t('settings.open-links-http'),
            desc: () => t('settings.open-links-http-description'),
          }, {
            key: 'browserInterceptHttps',
            title: () => t('settings.open-links-https'),
            desc: () => t('settings.open-links-https-description'),
          }],
        },
        title: () => t('browser'),
      },
      center: {
        render: surface => {
          if (surface.kind !== 'browser') return null
          return <BrowserSurfaceView surface={surface as BrowserCenterSurface} t={t} />
        },
      },
      scopeNeed: null,
      previewable: true,
      focusPolicy: 'never',
    })
    return () => {
      removeSurface()
    }
  }, 'sidebar-desktop: browser surface')
}

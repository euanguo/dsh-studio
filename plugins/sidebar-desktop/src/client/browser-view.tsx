import {
  IconChevronLeftOutline14,
  IconRefreshOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import { ErrorState, ToolbarAction } from '@dsh-studio/shared/ui'
import type { SidebarRenderProps } from '@dsh-studio/sidebar/client/contract'
import type { BrowserCenterSurface } from '@dsh-studio/sidebar/client/surfaces-types'
import type { WorkspaceMessage } from '@dsh-studio/sidebar/client/i18n'
import {
  useElectronWebview,
} from './use-electron-webview.ts'

/**
 * The address strip both browser surfaces share. The browser is its own
 * chrome (NOT the shared SurfaceToolbar — that strip is for file/view
 * surfaces): back/reload ToolbarActions, then the omnibox field owning
 * every remaining pixel. Enter navigates — no separate Go capsule.
 */
function BrowserActionBar({
  address,
  canGoBack,
  t,
  onAddressChange,
  onBack,
  onReload,
  onSubmit,
}: {
  address: string
  canGoBack: boolean
  t: Translate<WorkspaceMessage>
  onAddressChange(next: string): void
  onBack(): void
  onReload(): void
  onSubmit(): void
}): JSX.Element {
  return (
    <form
      className="dsh-studio-browser-bar"
      onSubmit={event => { event.preventDefault(); onSubmit() }}
    >
      <ToolbarAction
        type="button"
        disabled={!canGoBack}
        label={t('browser.back')}
        icon={<IconChevronLeftOutline14 size={16} />}
        onClick={onBack}
      />
      <ToolbarAction
        type="button"
        label={t('browser.reload')}
        icon={<IconRefreshOutline16 size={16} />}
        onClick={onReload}
      />
      <Input
        className="dsh-studio-browser-address"
        value={address}
        placeholder={t('browser.enter-url')}
        aria-label={t('browser.url')}
        onChange={event => { onAddressChange(event.currentTarget.value) }}
      />
    </form>
  )
}

/**
 * Electron `<webview>` browser surface. This is a DESKTOP-ONLY capability
 * (the `<webview>` tag is Electron-specific); the generic sidebar must not
 * depend on it, so this component is the seam that later moves into the
 * desktop add-on plugin.
 */
export function BrowserView({
  patch,
  t,
  tab,
}: SidebarRenderProps & {
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const {
    containerRef,
    webviewRef,
    address,
    setAddress,
    error,
    canGoBack,
    navigate,
  } = useElectronWebview(
    tab.id,
    tab.resource,
    t,
    (resource, title) => patch({ resource, title }),
  )

  return (
    <div className="dsh-studio-browser-view">
      <BrowserActionBar
        address={address}
        canGoBack={canGoBack}
        t={t}
        onAddressChange={setAddress}
        onBack={() => { webviewRef.current?.goBack() }}
        onReload={() => { webviewRef.current?.reload() }}
        onSubmit={() => { void navigate() }}
      />
      {error !== '' && <ErrorState className="dsh-studio-browser-error" message={error} />}
      <div ref={containerRef} className="dsh-studio-browser-host" />
    </div>
  )
}

/**
 * Center-surface browser renderer: same `<webview>` host, no address bar
 * (the surface tab carries the title). Also desktop-only — moves with
 * {@link BrowserView} into the desktop add-on plugin.
 */
export function BrowserSurfaceView({
  surface,
  t,
}: {
  surface: BrowserCenterSurface
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const {
    containerRef,
    webviewRef,
    address,
    setAddress,
    error,
    canGoBack,
    navigate,
  } = useElectronWebview(
    surface.id,
    surface.resource,
    t,
    () => {},
  )

  return (
    <div className="dsh-studio-browser-view">
      <BrowserActionBar
        address={address}
        canGoBack={canGoBack}
        t={t}
        onAddressChange={setAddress}
        onBack={() => { webviewRef.current?.goBack() }}
        onReload={() => { webviewRef.current?.reload() }}
        onSubmit={() => { void navigate() }}
      />
      {error !== '' && <ErrorState className="dsh-studio-browser-error" message={error} />}
      <div ref={containerRef} className="dsh-studio-browser-host" />
    </div>
  )
}
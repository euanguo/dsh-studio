import { useEffect, useRef, useState } from 'react'
import type { Translate } from '../../../shared/i18n.ts'
import { IconArrowLeft, IconRefresh } from '../../../shared/icons.tsx'
import type { SidebarRenderProps } from '../../../sidebar/src/client/contract.ts'
import type { BrowserCenterSurface } from '../../../sidebar/src/client/surfaces/types.ts'
import type { WorkspaceMessage } from '../../../sidebar/src/client/i18n.ts'

/**
 * Electron `<webview>` browser surface. This is a DESKTOP-ONLY capability
 * (the `<webview>` tag is Electron-specific); the generic sidebar must not
 * depend on it, so this component is the seam that later moves into the
 * desktop add-on plugin.
 */
export interface ElectronWebviewElement extends HTMLElement {
  canGoBack(): boolean
  getURL(): string
  goBack(): void
  loadURL(url: string): Promise<void>
  reload(): void
}

function normalizeBrowserUrl(
  raw: string,
  t: Translate<WorkspaceMessage>,
): string {
  const value = raw.trim()
  if (value === '') throw new Error(t('browser.enter-url'))
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(value)
    ? value
    : `https://${value}`)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(t('browser.http-only'))
  }
  return url.href
}

export function BrowserView({
  patch,
  t,
  tab,
}: SidebarRenderProps & {
  t: Translate<WorkspaceMessage>
}): JSX.Element {
  const container = useRef<HTMLDivElement | null>(null)
  const webview = useRef<ElectronWebviewElement | null>(null)
  const [address, setAddress] = useState(tab.resource ?? '')
  const [error, setError] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)

  useEffect(() => {
    const host = container.current
    if (host === null) return
    const element = document.createElement('webview') as unknown as ElectronWebviewElement
    element.className = 'oh-dsh-browser-webview'
    element.setAttribute('partition', 'persist:oh-dsh-browser')
    element.setAttribute('src', tab.resource ?? 'about:blank')
    const update = (event: Event): void => {
      const next = 'url' in event && typeof event.url === 'string'
        ? event.url
        : element.getURL()
      if (next !== '' && next !== 'about:blank') {
        try {
          const safe = normalizeBrowserUrl(next, t)
          const url = new URL(safe)
          setAddress(safe)
          patch({ resource: safe, title: url.hostname || t('browser') })
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : String(nextError))
        }
      }
      setCanGoBack(element.canGoBack())
    }
    const guard = (event: Event): void => {
      if (!('url' in event) || typeof event.url !== 'string') return
      try {
        normalizeBrowserUrl(event.url, t)
      } catch (nextError) {
        event.preventDefault()
        setError(nextError instanceof Error ? nextError.message : String(nextError))
      }
    }
    const failed = (event: Event): void => {
      const description = 'errorDescription' in event
        ? String(event.errorDescription)
        : t('browser.page-failed')
      setError(description)
    }
    element.addEventListener('did-navigate', update)
    element.addEventListener('did-navigate-in-page', update)
    element.addEventListener('will-navigate', guard)
    element.addEventListener('did-fail-load', failed)
    host.append(element)
    webview.current = element
    return () => {
      webview.current = null
      element.remove()
    }
  }, [tab.id])

  const navigate = async (): Promise<void> => {
    try {
      const url = normalizeBrowserUrl(address, t)
      setAddress(url)
      setError('')
      await webview.current?.loadURL(url)
    } catch (next) {
      setError(next instanceof Error ? next.message : String(next))
    }
  }

  return (
    <div className="oh-dsh-browser-view">
      <form
        className="oh-dsh-browser-bar"
        onSubmit={event => { event.preventDefault(); void navigate() }}
      >
        <button
          type="button"
          disabled={!canGoBack}
          aria-label={t('browser.back')}
          onClick={() => { webview.current?.goBack() }}
        ><IconArrowLeft size={16} /></button>
        <button
          type="button"
          aria-label={t('browser.reload')}
          onClick={() => { webview.current?.reload() }}
        ><IconRefresh size={16} /></button>
        <input
          value={address}
          placeholder={t('browser.enter-url')}
          aria-label={t('browser.url')}
          onChange={event => { setAddress(event.currentTarget.value) }}
        />
        <button type="submit">{t('browser.go')}</button>
      </form>
      {error !== '' && <div className="oh-dsh-browser-error" role="alert">{error}</div>}
      <div ref={container} className="oh-dsh-browser-host" />
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
  const container = useRef<HTMLDivElement | null>(null)
  const webview = useRef<ElectronWebviewElement | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const host = container.current
    if (host === null) return
    const element = document.createElement('webview') as unknown as ElectronWebviewElement
    element.className = 'oh-dsh-browser-webview'
    element.setAttribute('partition', 'persist:oh-dsh-browser')
    element.setAttribute('src', surface.resource ?? 'about:blank')
    const failed = (event: Event): void => {
      const description = 'errorDescription' in event
        ? String(event.errorDescription)
        : t('browser.page-failed')
      setError(description)
    }
    element.addEventListener('did-fail-load', failed)
    host.append(element)
    webview.current = element
    return () => {
      webview.current = null
      element.remove()
    }
  }, [surface.resource, t])

  if (error !== '') return <div className="oh-dsh-side-error" role="alert">{error}</div>
  return <div ref={container} className="oh-dsh-browser-host" />
}

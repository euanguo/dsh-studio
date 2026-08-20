import { useEffect, useRef, useState } from 'react'
import {
  Button,
  IconChevronLeftOutline14,
  IconRefreshOutline16,
  Input,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import { ErrorState } from '@dsh-studio/shared/ui'
import type { SidebarRenderProps } from '@dsh-studio/sidebar/client/contract'
import type { BrowserCenterSurface } from '@dsh-studio/sidebar/client/surfaces-types'
import type { WorkspaceMessage } from '@dsh-studio/sidebar/client/i18n'
import {
  getLiveBrowserUrl,
  rememberLiveBrowserUrl,
} from './browser-runtime.ts'

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
  const [address, setAddress] = useState(tab.resource ?? getLiveBrowserUrl(tab.id) ?? '')
  const [error, setError] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)

  useEffect(() => {
    const host = container.current
    if (host === null) return
    const element = document.createElement('webview') as unknown as ElectronWebviewElement
    element.className = 'dsh-studio-browser-webview'
    element.setAttribute('partition', 'persist:dsh-studio-browser')
    element.setAttribute('src', tab.resource ?? getLiveBrowserUrl(tab.id) ?? 'about:blank')
    const update = (event: Event): void => {
      const next = 'url' in event && typeof event.url === 'string'
        ? event.url
        : element.getURL()
      if (next !== '' && next !== 'about:blank') {
        try {
          const safe = normalizeBrowserUrl(next, t)
          const url = new URL(safe)
          setAddress(safe)
          rememberLiveBrowserUrl(tab.id, safe)
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
    <div className="dsh-studio-browser-view">
      <form
        className="dsh-studio-browser-bar"
        onSubmit={event => { event.preventDefault(); void navigate() }}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canGoBack}
          aria-label={t('browser.back')}
          icon={<IconChevronLeftOutline14 size={16} />}
          onClick={() => { webview.current?.goBack() }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('browser.reload')}
          icon={<IconRefreshOutline16 size={16} />}
          onClick={() => { webview.current?.reload() }}
        />
        <Input
          value={address}
          placeholder={t('browser.enter-url')}
          aria-label={t('browser.url')}
          onChange={event => { setAddress(event.currentTarget.value) }}
        />
        <Button type="submit" variant="primary" size="sm">{t('browser.go')}</Button>
      </form>
      {error !== '' && <ErrorState className="dsh-studio-browser-error" message={error} />}
      <div ref={container} className="dsh-studio-browser-host" />
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
  const [address, setAddress] = useState(surface.resource ?? getLiveBrowserUrl(surface.id) ?? '')
  const [error, setError] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)

  useEffect(() => {
    const host = container.current
    if (host === null) return
    const element = document.createElement('webview') as unknown as ElectronWebviewElement
    element.className = 'dsh-studio-browser-webview'
    element.setAttribute('partition', 'persist:dsh-studio-browser')
    element.setAttribute('src', surface.resource ?? getLiveBrowserUrl(surface.id) ?? 'about:blank')
    const update = (event: Event): void => {
      const next = 'url' in event && typeof event.url === 'string'
        ? event.url
        : element.getURL()
      if (next !== '' && next !== 'about:blank') {
        try {
          const safe = normalizeBrowserUrl(next, t)
          setAddress(safe)
          rememberLiveBrowserUrl(surface.id, safe)
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
  }, [surface.resource, t])

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
    <div className="dsh-studio-browser-view">
      <form
        className="dsh-studio-browser-bar"
        onSubmit={event => { event.preventDefault(); void navigate() }}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canGoBack}
          aria-label={t('browser.back')}
          icon={<IconChevronLeftOutline14 size={16} />}
          onClick={() => { webview.current?.goBack() }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={t('browser.reload')}
          icon={<IconRefreshOutline16 size={16} />}
          onClick={() => { webview.current?.reload() }}
        />
        <Input
          value={address}
          placeholder={t('browser.enter-url')}
          aria-label={t('browser.url')}
          onChange={event => { setAddress(event.currentTarget.value) }}
        />
        <Button type="submit" variant="primary" size="sm">{t('browser.go')}</Button>
      </form>
      {error !== '' && <ErrorState className="dsh-studio-browser-error" message={error} />}
      <div ref={container} className="dsh-studio-browser-host" />
    </div>
  )
}

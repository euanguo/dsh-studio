import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { Translate } from '@dsh-studio/shared/i18n'
import { errorMessage } from '@dsh-studio/shared/errors'
import type { WorkspaceMessage } from '@dsh-studio/sidebar/client/i18n'
import {
  getLiveBrowserUrl,
  rememberLiveBrowserUrl,
} from './browser-runtime.ts'

/**
 * Electron `<webview>` backing element. Desktop-only: the tag is
 * Electron-specific, so this seam lives under the desktop add-on plugin.
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

export interface ElectronWebviewHandle {
  containerRef: RefObject<HTMLDivElement>
  webviewRef: RefObject<ElectronWebviewElement>
  address: string
  setAddress: Dispatch<SetStateAction<string>>
  error: string
  setError: Dispatch<SetStateAction<string>>
  canGoBack: boolean
  navigate(): Promise<void>
}

/**
 * Naming contract: `useElectronWebview(id, initialResource, t, onNavigate)`.
 *
 * Shared `<webview>` lifecycle for the sidebar tab and the center-surface
 * browser views. Owns the element, its navigation event wiring, the address /
 * error / can-go-back state and the live-URL retention. The effect depends
 * ONLY on `id`: a resource update or a locale re-render must not tear down
 * and rebuild the webview, because that discards the in-page navigation
 * state. The mutable `t` and `onNavigate` callbacks are carried in refs so
 * they never force a rebuild.
 */
export function useElectronWebview(
  id: string,
  initialResource: string | undefined,
  t: Translate<WorkspaceMessage>,
  onNavigate: (resource: string, title: string) => void,
): ElectronWebviewHandle {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const webviewRef = useRef<ElectronWebviewElement | null>(null)
  const [address, setAddress] = useState(initialResource ?? getLiveBrowserUrl(id) ?? '')
  const [error, setError] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)

  // Mutable callbacks carried in refs so the effect can hold `[id]` alone.
  const tRef = useRef(t)
  tRef.current = t
  const onNavigateRef = useRef(onNavigate)
  onNavigateRef.current = onNavigate

  useEffect(() => {
    const host = containerRef.current
    if (host === null) return
    const element = document.createElement('webview') as unknown as ElectronWebviewElement
    element.className = 'dsh-studio-browser-webview'
    element.setAttribute('partition', 'persist:dsh-studio-browser')
    element.setAttribute('src', initialResource ?? getLiveBrowserUrl(id) ?? 'about:blank')
    const update = (event: Event): void => {
      const next = 'url' in event && typeof event.url === 'string'
        ? event.url
        : element.getURL()
      if (next !== '' && next !== 'about:blank') {
        try {
          const safe = normalizeBrowserUrl(next, tRef.current)
          const url = new URL(safe)
          setAddress(safe)
          // C47: a successful navigation clears a stale error banner.
          setError('')
          rememberLiveBrowserUrl(id, safe)
          onNavigateRef.current(safe, url.hostname || tRef.current('browser'))
        } catch (nextError) {
          setError(errorMessage(nextError))
        }
      }
      setCanGoBack(element.canGoBack())
    }
    const guard = (event: Event): void => {
      if (!('url' in event) || typeof event.url !== 'string') return
      try {
        normalizeBrowserUrl(event.url, tRef.current)
      } catch (nextError) {
        event.preventDefault()
        setError(errorMessage(nextError))
      }
    }
    const failed = (event: Event): void => {
      const description = 'errorDescription' in event
        ? String(event.errorDescription)
        : tRef.current('browser.page-failed')
      setError(description)
    }
    element.addEventListener('did-navigate', update)
    element.addEventListener('did-navigate-in-page', update)
    element.addEventListener('will-navigate', guard)
    element.addEventListener('did-fail-load', failed)
    host.append(element)
    webviewRef.current = element
    return () => {
      webviewRef.current = null
      element.remove()
    }
  }, [id])

  const navigate = async (): Promise<void> => {
    try {
      const url = normalizeBrowserUrl(address, tRef.current)
      setAddress(url)
      setError('')
      await webviewRef.current?.loadURL(url)
    } catch (next) {
      setError(errorMessage(next))
    }
  }

  return {
    containerRef,
    webviewRef,
    address,
    setAddress,
    error,
    setError,
    canGoBack,
    navigate,
  }
}
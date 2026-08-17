/**
 * Interception layer of the desktop sidebar: the `workspaces.openPath`
 * takeover and the external-link click capture.
 *
 * The openPath patch is installed ONCE per workspaces service instance and
 * refcounted across plugin activations, so HMR re-activation can never
 * double-patch or restore the original under an active peer. Handlers
 * register/unregister individually and the stable wrapper forwards to the
 * current handler set.
 */
import type { WorkspacesService } from './client-types.ts'

/** One openPath handler; returns true when it handled the path. */
export type OpenPathHandler = (path: string) => boolean | Promise<boolean>

const openPathHandlers = new Set<OpenPathHandler>()

export function registerOpenPathHandler(handler: OpenPathHandler): () => void {
  openPathHandlers.add(handler)
  return () => { openPathHandlers.delete(handler) }
}

async function runOpenPathHandlers(path: string): Promise<boolean> {
  for (const handler of [...openPathHandlers]) {
    if (await handler(path)) return true
  }
  return false
}

interface OpenPathPatchState {
  original: (path: string) => Promise<void>
  wrapper: (path: string) => Promise<void>
  count: number
}

/** One stable patch per workspaces service instance (never double-patched). */
const openPathPatches = new WeakMap<object, OpenPathPatchState>()

export function acquireOpenPathPatch(workspaces: WorkspacesService): void {
  const existing = openPathPatches.get(workspaces)
  if (existing !== undefined) {
    existing.count += 1
    return
  }
  const original = workspaces.openPath
  const wrapper = async (path: string): Promise<void> => {
    if (await runOpenPathHandlers(path)) return
    await original.call(workspaces, path)
  }
  workspaces.openPath = wrapper
  openPathPatches.set(workspaces, { original, wrapper, count: 1 })
}

export function releaseOpenPathPatch(workspaces: WorkspacesService): void {
  const existing = openPathPatches.get(workspaces)
  if (existing === undefined) return
  existing.count -= 1
  if (existing.count > 0) return
  openPathPatches.delete(workspaces)
  // Restore only when the stable wrapper is still the live implementation
  // (a later activation may have installed a fresh service instance).
  if (workspaces.openPath === existing.wrapper) {
    workspaces.openPath = existing.original
  }
}

/** One external-link interception; returns true when it handled the click. */
export type LinkHandler = (url: URL) => boolean

const linkHandlers = new Set<LinkHandler>()

/**
 * The per-protocol gate of the external-link takeover (mirrors the upstream
 * `browserInterceptHttp` / `browserInterceptHttps` split): only protocols
 * whose flag is on may be taken over into the sidebar. The DOM listener only
 * reaches handlers with `http:`/`https:` links, so every other protocol is
 * conservatively refused here. Pure — the unit tests cover the matrix
 * without a DOM.
 */
export function isLinkProtocolIntercepted(
  protocol: string,
  prefs: { browserInterceptHttp: boolean; browserInterceptHttps: boolean },
): boolean {
  if (protocol === 'https:') return prefs.browserInterceptHttps
  if (protocol === 'http:') return prefs.browserInterceptHttp
  return false
}

export function registerLinkHandler(handler: LinkHandler): () => void {
  linkHandlers.add(handler)
  return () => { linkHandlers.delete(handler) }
}

function runLinkHandlers(url: URL, event: MouseEvent): boolean {
  for (const handler of [...linkHandlers]) {
    if (handler(url)) {
      event.preventDefault()
      return true
    }
  }
  return false
}

/**
 * Capture-phase click listener over the whole document: external http(s)
 * links (chat messages, tool rows, prose mentions) are offered to the
 * registered handlers instead of opening a new window. Ctrl/Cmd/Shift/Alt
 * clicks bypass the takeover.
 */
export function registerLinkInterception(): () => void {
  const listener = (event: MouseEvent): void => {
    if (event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return
    }
    const target = event.target
    const anchor = target instanceof Element
      ? target.closest<HTMLAnchorElement>('a[href]')
      : null
    if (anchor === null || anchor.hasAttribute('download')) return
    let url: URL
    try { url = new URL(anchor.href, window.location.href) } catch { return }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return
    if (url.origin === window.location.origin) return
    runLinkHandlers(url, event)
  }
  document.addEventListener('click', listener, true)
  return () => { document.removeEventListener('click', listener, true) }
}

/**
 * The official open hook of the desktop sidebar — the single implementation
 * behind the workbench OpenPipeline's two OS-level open takeovers
 * (target-design §3.2 "openPath 劫持收编"):
 *
 *  - the `workspaces.openPath` takeover: external opens are offered to the
 *    pipeline's file-preview claim before the host falls back to its own
 *    handling;
 *  - the external-link claim table: http(s) anchor clicks are offered to the
 *    registered claims instead of opening a new window.
 *
 * The openPath patch is installed ONCE per workspaces service instance and
 * refcounted across plugin activations, so HMR re-activation can never
 * double-patch or restore the original under an active peer (G4:
 * install → install → dispose ≡ a single install until the last dispose).
 * Every activation gets its own claim tables through
 * {@linkcode installOfficialOpenHook}; the stable wrapper always forwards to
 * the live claim set.
 */
import type { WorkspacesService } from './client-types.ts'

/** One openPath claim; returns true when it handled the path. */
export type OpenPathHandler = (path: string) => boolean | Promise<boolean>

/** One external-link claim; returns true when it handled the URL. */
export type LinkHandler = (url: URL) => boolean

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

/** Per-activation claim tables. */
interface OpenHookClaims {
  readonly openPath: Set<OpenPathHandler>
  readonly link: Set<LinkHandler>
}

/** One refcounted patch per workspaces service instance (never double-patched). */
interface OpenPathPatchState {
  readonly owner: WorkspacesService
  readonly original: (path: string) => Promise<void>
  readonly wrapper: (path: string) => Promise<void>
  count: number
  readonly claims: Set<OpenHookClaims>
}

const openPathPatches = new WeakMap<WorkspacesService, OpenPathPatchState>()

/** The live patch states (a WeakMap is not iterable; the click dispatcher
 *  walks every installed takeover). */
const livePatchStates = new Set<OpenPathPatchState>()

export interface OfficialOpenHook {
  /** Register one openPath claim for this activation. */
  onOpenPath(handler: OpenPathHandler): () => void
  /** Register one external-link claim for this activation. */
  onLink(handler: LinkHandler): () => void
  /** Release this activation's reference and claims. */
  dispose(): void
}

/* ---------- external-link claim dispatch ---------- */

/**
 * Capture-phase click listener over the whole document; lives while at
 * least one official open hook is installed. External http(s) links (chat
 * messages, tool rows, prose mentions) are offered to the registered claims
 * instead of opening a new window. Ctrl/Cmd/Shift/Alt clicks bypass the
 * takeover.
 */
function handleDocumentClick(event: MouseEvent): void {
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
  for (const state of livePatchStates) {
    for (const claims of state.claims) {
      let claimed = false
      for (const handler of [...claims.link]) {
        if (handler(url)) {
          event.preventDefault()
          claimed = true
          break
        }
      }
      if (claimed) return
    }
  }
}

let linkDomRefCount = 0

/** The click capture needs a DOM; headless hosts (unit fixtures) skip it. */
function linkDom(): Document | undefined {
  return typeof document === 'undefined' ? undefined : document
}

function acquireLinkDomListener(): void {
  linkDomRefCount += 1
  const dom = linkDom()
  if (linkDomRefCount === 1 && dom !== undefined) {
    dom.addEventListener('click', handleDocumentClick, true)
  }
}

function releaseLinkDomListener(): void {
  linkDomRefCount -= 1
  const dom = linkDom()
  if (linkDomRefCount === 0 && dom !== undefined) {
    dom.removeEventListener('click', handleDocumentClick, true)
  }
}

/**
 * Install the official open hook for one plugin activation. Repeated calls
 * for the same workspaces service share one refcounted patch (HMR
 * idempotent); each returned hook carries its own claim tables and
 * `dispose()` releases exactly one reference.
 */
export function installOfficialOpenHook(workspaces: WorkspacesService): OfficialOpenHook {
  let state = openPathPatches.get(workspaces)
  if (state === undefined) {
    const original = workspaces.openPath
    const claims = new Set<OpenHookClaims>()
    const wrapper = async (path: string): Promise<void> => {
      for (const table of claims) {
        for (const handler of [...table.openPath]) {
          if (await handler(path)) return
        }
      }
      await original.call(workspaces, path)
    }
    state = { owner: workspaces, original, wrapper, count: 0, claims }
    workspaces.openPath = wrapper
    openPathPatches.set(workspaces, state)
    livePatchStates.add(state)
  }
  const table: OpenHookClaims = { openPath: new Set(), link: new Set() }
  state.count += 1
  state.claims.add(table)
  acquireLinkDomListener()
  return {
    onOpenPath(handler) {
      table.openPath.add(handler)
      return () => { table.openPath.delete(handler) }
    },
    onLink(handler) {
      table.link.add(handler)
      return () => { table.link.delete(handler) }
    },
    dispose() {
      state.claims.delete(table)
      state.count -= 1
      releaseLinkDomListener()
      if (state.count > 0) return
      openPathPatches.delete(workspaces)
      livePatchStates.delete(state)
      // Restore only when the stable wrapper is still the live implementation
      // (a later activation may have installed a fresh service instance).
      if (workspaces.openPath === state.wrapper) {
        workspaces.openPath = state.original
      }
    },
  }
}

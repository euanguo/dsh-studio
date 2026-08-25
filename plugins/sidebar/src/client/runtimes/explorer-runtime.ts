/**
 * Explorer directory-listing runtime (ported from the reference project's
 * `cache/workspace-explorer-runtime.ts`).
 *
 * Lazy per-directory listing cache for one workspace root:
 * - keys are repo-relative directory paths ("" = root)
 * - phases: Loading → Ready / Empty / Error; Ready/Empty hits short-circuit
 *   with zero network (this is what makes switching back instant)
 * - GenerationGate discards stale responses after the root changes
 * - LRU-capped listings (root and in-flight keys are protected from eviction)
 * - in-flight dedup so concurrent expansions share one request
 *
 * The runtime owns DATA only; UI chrome (expanded/selected) lives in the
 * chrome store. Views subscribe via `useSyncExternalStore`.
 */
import { RevisionedStore, GenerationGate } from '@dsh-studio/shared/runtime'
import { errorMessage } from '@dsh-studio/shared/errors'

export type ExplorerListingPhase = 'loading' | 'ready' | 'empty' | 'error'

export interface ExplorerListing {
  phase: ExplorerListingPhase
  /** Directory entry names (files + directories) when ready/empty. */
  entries: readonly ExplorerListingEntry[]
  message?: string
}

export interface ExplorerListingEntry {
  name: string
  /** Absolute path (resolved by the transport against the workspace root). */
  path: string
  isDirectory: boolean
}

export interface WorkspaceExplorerTransport {
  listDirectory(
    relativePath: string,
    signal?: AbortSignal,
  ): Promise<readonly ExplorerListingEntry[]>
}

/** Max retained directory listings per workspace explorer runtime (LRU). */
export const WORKSPACE_EXPLORER_LISTING_MAX_ENTRIES = 64

export function explorerListingKey(relativePath: string | null | undefined): string {
  return relativePath ?? ''
}

export class WorkspaceExplorerRuntime {
  private readonly transport: WorkspaceExplorerTransport
  private readonly store = new RevisionedStore<{ cwd: string | null }>({ cwd: null })
  private readonly generation = new GenerationGate()
  private listings = new Map<string, ExplorerListing>()
  private inflight = new Map<string, Promise<void>>()
  /** Per-listing transport abort controls, so setScope / dispose / eviction
   *  can cancel in-flight fs.tree calls instead of letting them linger. */
  private aborts = new Map<string, AbortController>()
  private disposed = false
  private readonly maxListings: number

  constructor(transport: WorkspaceExplorerTransport, maxListings = WORKSPACE_EXPLORER_LISTING_MAX_ENTRIES) {
    this.transport = transport
    this.maxListings = Math.max(1, maxListings)
  }

  getCwd = (): string | null => (this.disposed ? null : this.store.getSnapshot().cwd)

  getListing = (relativePath: string | null | undefined): ExplorerListing | undefined => {
    if (this.disposed) return undefined
    this.store.getSnapshot()
    return this.listings.get(explorerListingKey(relativePath))
  }

  getListingsSnapshot = (): ReadonlyMap<string, ExplorerListing> => {
    if (this.disposed) return new Map()
    this.store.getSnapshot()
    return new Map(this.listings)
  }

  subscribe = this.store.subscribe

  /** Fingerprint for useSyncExternalStore: changes only when a listing changes. */
  listingsFingerprint = (): string => {
    let fingerprint = `${this.listings.size}`
    for (const [key, listing] of this.listings) {
      fingerprint += `|${key}:${listing.phase}`
      if (listing.phase === 'ready' || listing.phase === 'empty') {
        fingerprint += `:${listing.entries.length}`
      }
    }
    return fingerprint
  }

  setWorkspaceRoot(cwd: string | null): void {
    this.assertOpen()
    if (this.store.getSnapshot().cwd === cwd) return
    this.generation.next()
    this.abortAll()
    this.listings.clear()
    this.inflight.clear()
    this.store.setState({ cwd })
    if (cwd !== null && cwd.length > 0) {
      void this.ensureListing(null)
    }
  }

  async ensureListing(relativePath: string | null | undefined): Promise<void> {
    this.assertOpen()
    const cwd = this.store.getSnapshot().cwd
    if (cwd === null || cwd.length === 0) return
    const key = explorerListingKey(relativePath)
    const existing = this.listings.get(key)
    if (existing !== undefined && (existing.phase === 'ready' || existing.phase === 'empty')) {
      this.touchListing(key, existing)
      return
    }

    const pending = this.inflight.get(key)
    if (pending !== undefined) {
      await pending
      return
    }

    const requestGeneration = this.generation.current()
    this.putListing(key, { phase: 'loading', entries: [] })
    this.emit()

    const request = this.loadListing({ cwd, key, requestGeneration })
    this.inflight.set(key, request)
    try {
      await request
    } finally {
      if (this.inflight.get(key) === request) {
        this.inflight.delete(key)
      }
    }
  }

  /** Drop one listing and reload it (directory refresh). */
  async refresh(relativePath: string | null | undefined = null): Promise<void> {
    this.assertOpen()
    const key = explorerListingKey(relativePath)
    this.abort(key)
    this.listings.delete(key)
    this.inflight.delete(key)
    await this.ensureListing(relativePath)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation.next()
    this.abortAll()
    this.listings.clear()
    this.inflight.clear()
    this.store.dispose()
  }

  private async loadListing(input: {
    cwd: string
    key: string
    requestGeneration: number
  }): Promise<void> {
    const controller = new AbortController()
    this.aborts.set(input.key, controller)
    try {
      const result = await this.transport.listDirectory(input.key, controller.signal)
      this.clearAbort(input.key)
      if (this.disposed || !this.generation.isCurrent(input.requestGeneration)) return
      this.putListing(input.key, result.length === 0
        ? { phase: 'empty', entries: [] }
        : { phase: 'ready', entries: result })
      this.emit()
    } catch (cause) {
      this.clearAbort(input.key)
      if (this.disposed || !this.generation.isCurrent(input.requestGeneration)) return
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      this.putListing(input.key, {
        phase: 'error',
        entries: [],
        message: errorMessage(cause),
      })
      this.emit()
    }
  }

  /** Cancel and forget one in-flight transport call, if any. */
  private abort(key: string): void {
    this.aborts.get(key)?.abort()
    this.aborts.delete(key)
  }

  /** Cancel and forget every in-flight transport call. */
  private abortAll(): void {
    for (const controller of this.aborts.values()) controller.abort()
    this.aborts.clear()
  }

  private clearAbort(key: string): void {
    this.aborts.delete(key)
  }

  private touchListing(key: string, listing: ExplorerListing): void {
    this.listings.delete(key)
    this.listings.set(key, listing)
  }

  private putListing(key: string, listing: ExplorerListing): void {
    this.touchListing(key, listing)
    this.evictListingsOverflow(key)
  }

  /**
   * Evict oldest listings (Map insertion order) until under maxListings.
   * Prefer keeping the just-written key; root ("") is also protected when present.
   */
  private evictListingsOverflow(protectKey: string): void {
    const protectedKeys = new Set<string>([protectKey])
    // Root listing is the navigation anchor — keep it if possible.
    if (this.listings.has('')) protectedKeys.add('')

    while (this.listings.size > this.maxListings) {
      let victim: string | null = null
      for (const key of this.listings.keys()) {
        if (protectedKeys.has(key)) continue
        // Don't evict inflight keys mid-load.
        if (this.inflight.has(key)) continue
        victim = key
        break
      }
      if (victim === null) break
      this.abort(victim)
      this.listings.delete(victim)
    }
  }

  private emit(): void {
    this.store.setState(current => ({ ...current }))
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('WorkspaceExplorerRuntime is disposed.')
  }
}

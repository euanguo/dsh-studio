/**
 * Workspace file runtime (ported from the reference project's
 * `cache/workspace-file-runtime.ts` pattern): caches file reads per path so
 * previews/tabs opened before render instantly from the retained snapshot.
 */
import { RevisionedStore } from '@dsh-studio/shared/runtime'
import { errorMessage } from '@dsh-studio/shared/errors'

export interface WorkspaceFileSnapshot {
  kind: 'text' | 'binary'
  content: string | null
  binary: boolean
  size: number
  truncated: boolean
  /** Base64 payload for binary previews (images / PDFs). */
  data?: string
}

export interface WorkspaceFileTransport {
  read(path: string, signal?: AbortSignal): Promise<WorkspaceFileSnapshot>
}

export type WorkspaceFileRuntimePhase = 'idle' | 'loading' | 'ready' | 'error'

export interface WorkspaceFileEntryState {
  phase: WorkspaceFileRuntimePhase
  snapshot: WorkspaceFileSnapshot | null
  message?: string
}

export const WORKSPACE_FILE_CACHE_MAX_ENTRIES = 64

/** How long a failed read stays trusted before the next read retries disk. */
export const WORKSPACE_FILE_ERROR_TTL_MS = 5000

export class WorkspaceFileRuntime {
  private readonly transport: WorkspaceFileTransport
  private readonly store = new RevisionedStore<{ root: string | null }>({ root: null })
  private entries = new Map<string, WorkspaceFileEntryState>()
  private inflight = new Map<string, Promise<void>>()
  /** Per-path transport abort controls (setScope / dispose / eviction / retry). */
  private aborts = new Map<string, AbortController>()
  /** Timestamp when each path last hit the error phase, for the retry TTL. */
  private errorAt = new Map<string, number>()
  private disposed = false
  private readonly maxEntries: number

  constructor(transport: WorkspaceFileTransport, maxEntries = WORKSPACE_FILE_CACHE_MAX_ENTRIES) {
    this.transport = transport
    this.maxEntries = Math.max(1, maxEntries)
  }

  getRoot = (): string | null => (this.disposed ? null : this.store.getSnapshot().root)

  getEntry = (path: string): WorkspaceFileEntryState | undefined => {
    if (this.disposed) return undefined
    this.store.getSnapshot()
    return this.entries.get(path)
  }

  subscribe = this.store.subscribe

  fingerprint = (): string => {
    let fingerprint = `${this.entries.size}`
    for (const [path, entry] of this.entries) {
      fingerprint += `|${path}:${entry.phase}`
      if (entry.phase === 'ready') {
        fingerprint += `:${entry.snapshot?.size ?? 0}`
      }
    }
    return fingerprint
  }

  setRoot(root: string): void {
    this.assertOpen()
    if (this.store.getSnapshot().root === root) return
    this.abortAll()
    this.entries.clear()
    this.inflight.clear()
    this.errorAt.clear()
    this.store.setState({ root })
  }

  /**
   * Read a file; Ready hits short-circuit, Error hits short-circuit only
   * within the retry TTL so a transient read failure is never cached forever
   * (a later call becomes a retry channel that re-reads disk).
   */
  async ensureLoaded(path: string): Promise<WorkspaceFileEntryState> {
    this.assertOpen()
    const existing = this.entries.get(path)
    if (existing !== undefined && existing.phase === 'ready') {
      this.touch(path, existing)
      return existing
    }
    if (existing !== undefined && existing.phase === 'error') {
      const failedAt = this.errorAt.get(path) ?? 0
      if (Date.now() - failedAt < WORKSPACE_FILE_ERROR_TTL_MS) {
        this.touch(path, existing)
        return existing
      }
      // TTL expired — drop the stale error and retry the read (retry channel).
      this.abort(path)
      this.entries.delete(path)
      this.errorAt.delete(path)
    }
    const pending = this.inflight.get(path)
    if (pending !== undefined) {
      await pending
      return this.entries.get(path) ?? { phase: 'error', snapshot: null, message: 'missing' }
    }

    this.put(path, { phase: 'loading', snapshot: null })
    this.emit()
    const request = this.load(path)
    this.inflight.set(path, request)
    try {
      await request
    } finally {
      if (this.inflight.get(path) === request) this.inflight.delete(path)
    }
    return this.entries.get(path) ?? { phase: 'error', snapshot: null, message: 'missing' }
  }

  invalidate(path: string): void {
    this.assertOpen()
    this.abort(path)
    this.entries.delete(path)
    this.inflight.delete(path)
    this.errorAt.delete(path)
    this.emit()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.abortAll()
    this.entries.clear()
    this.inflight.clear()
    this.errorAt.clear()
    this.store.dispose()
  }

  private async load(path: string): Promise<void> {
    const controller = new AbortController()
    this.aborts.set(path, controller)
    try {
      const snapshot = await this.transport.read(path, controller.signal)
      this.clearAbort(path)
      if (this.disposed) return
      this.errorAt.delete(path)
      this.put(path, { phase: 'ready', snapshot })
      this.emit()
    } catch (cause) {
      this.clearAbort(path)
      if (this.disposed) return
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      this.errorAt.set(path, Date.now())
      this.put(path, {
        phase: 'error',
        snapshot: null,
        message: errorMessage(cause),
      })
      this.emit()
    }
  }

  /** Cancel and forget one in-flight transport call, if any. */
  private abort(path: string): void {
    this.aborts.get(path)?.abort()
    this.aborts.delete(path)
  }

  /** Cancel and forget every in-flight transport call. */
  private abortAll(): void {
    for (const controller of this.aborts.values()) controller.abort()
    this.aborts.clear()
  }

  private clearAbort(path: string): void {
    this.aborts.delete(path)
  }

  private put(path: string, entry: WorkspaceFileEntryState): void {
    this.entries.delete(path)
    this.entries.set(path, entry)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      if (this.inflight.has(oldest)) break
      this.abort(oldest)
      this.entries.delete(oldest)
      this.errorAt.delete(oldest)
    }
  }

  private touch(path: string, entry: WorkspaceFileEntryState): void {
    this.entries.delete(path)
    this.entries.set(path, entry)
  }

  private emit(): void {
    this.store.setState(current => ({ ...current }))
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('WorkspaceFileRuntime is disposed.')
  }
}

/**
 * Workspace file runtime (ported from the reference project's
 * `cache/workspace-file-runtime.ts` pattern): caches file reads per path so
 * previews/tabs opened before render instantly from the retained snapshot.
 */
import { RevisionedStore } from '../../../../shared/runtime.ts'

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

export class WorkspaceFileRuntime {
  private readonly transport: WorkspaceFileTransport
  private readonly store = new RevisionedStore<{ root: string | null }>({ root: null })
  private entries = new Map<string, WorkspaceFileEntryState>()
  private inflight = new Map<string, Promise<void>>()
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
    this.entries.clear()
    this.inflight.clear()
    this.store.setState({ root })
  }

  /** Read a file; Ready/Error hits short-circuit. */
  async ensureLoaded(path: string): Promise<WorkspaceFileEntryState> {
    this.assertOpen()
    const existing = this.entries.get(path)
    if (existing !== undefined && (existing.phase === 'ready' || existing.phase === 'error')) {
      this.touch(path, existing)
      return existing
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
    this.entries.delete(path)
    this.inflight.delete(path)
    this.emit()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.entries.clear()
    this.inflight.clear()
    this.store.dispose()
  }

  private async load(path: string): Promise<void> {
    try {
      const snapshot = await this.transport.read(path)
      if (this.disposed) return
      this.put(path, { phase: 'ready', snapshot })
      this.emit()
    } catch (cause) {
      if (this.disposed) return
      this.put(path, {
        phase: 'error',
        snapshot: null,
        message: cause instanceof Error ? cause.message : String(cause),
      })
      this.emit()
    }
  }

  private put(path: string, entry: WorkspaceFileEntryState): void {
    this.entries.delete(path)
    this.entries.set(path, entry)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      if (this.inflight.has(oldest)) break
      this.entries.delete(oldest)
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

/**
 * Diff/commit review runtime (M1): retained per-scope cache for the diff
 * documents and file lists the center diff / commit / committed surfaces
 * render.
 *
 * Data lives here instead of component state, so switching tabs back
 * renders instantly from the retained snapshot (the same pattern as the
 * file / explorer / source-control runtimes); GenerationGate drops stale
 * loads after a scope reset; LRU caps the retained entries. UI chrome
 * (tree selection / collapsed directories) lives in the chrome store.
 */
import { GenerationGate, RevisionedStore } from '@dsh-studio/shared/runtime'
import { errorMessage } from '@dsh-studio/shared/errors'
import { parseGitReviewDiff, type GitReviewFile } from '../diff/git-review-diff.ts'

export type DiffEntryPhase = 'loading' | 'ready' | 'error'

export interface DiffDocEntry {
  phase: DiffEntryPhase
  diff: string | null
  message?: string
}

export interface DiffListEntry {
  phase: DiffEntryPhase
  files: readonly GitReviewFile[] | null
  message?: string
}

export interface WorkspaceDiffTransport {
  /** Worktree change area ("view all"): parsed review files (untracked synthesis included). */
  loadWorktreeList(staged: boolean, signal?: AbortSignal): Promise<GitReviewFile[]>
  /** One worktree file's raw diff at the given context width. */
  loadWorktreeDoc(staged: boolean, filePath: string, context: number, signal?: AbortSignal): Promise<string>
  loadCommitList(hash: string, signal?: AbortSignal): Promise<GitReviewFile[]>
  loadCommitDoc(hash: string, filePath: string, signal?: AbortSignal): Promise<string>
  loadCommittedList(baseRef: string, signal?: AbortSignal): Promise<GitReviewFile[]>
  loadCommittedDoc(baseRef: string, filePath: string, signal?: AbortSignal): Promise<string>
  /** Binary base64 payloads for an image diff (D8: kept in the runtime so a
   *  failed fetch renders an error branch instead of a permanent spinner). */
  loadImageDiff(staged: boolean, filePath: string, signal?: AbortSignal): Promise<{ oldData: string; newData: string }>
}

/** Image-diff cache entry (retained alongside the worktree docs). */
export interface DiffImageEntry {
  phase: DiffEntryPhase
  data: { oldData: string; newData: string } | null
  message?: string
}

export function worktreeImageKey(staged: boolean, filePath: string): string {
  return `img:w:${staged ? 'staged' : 'unstaged'}:${filePath}`
}

/** Max retained entries per diff runtime (LRU). */
export const WORKSPACE_DIFF_MAX_ENTRIES = 64

/* ---------- cache keys ---------- */

export function worktreeListKey(staged: boolean): string {
  return `list:w:${staged ? 'staged' : 'unstaged'}`
}

export function worktreeDocKey(staged: boolean, filePath: string, context: number): string {
  return `doc:w:${staged ? 'staged' : 'unstaged'}:${context}:${filePath}`
}

export function commitListKey(hash: string): string {
  return `list:c:${hash}`
}

export function commitDocKey(hash: string, filePath: string): string {
  return `doc:c:${hash}:${filePath}`
}

export function committedListKey(baseRef: string): string {
  return `list:m:${baseRef}`
}

export function committedDocKey(baseRef: string, filePath: string): string {
  return `doc:m:${baseRef}:${filePath}`
}

export class WorkspaceDiffRuntime {
  private readonly transport: WorkspaceDiffTransport
  private readonly store = new RevisionedStore<{ scope: string | null }>({ scope: null })
  private readonly generation = new GenerationGate()
  private entries = new Map<string, DiffDocEntry | DiffListEntry | DiffImageEntry>()
  private inflight = new Map<string, Promise<void>>()
  /** Per-entry transport abort controls (the explorer-runtime paradigm, D7):
   *  setScope / dispose / LRU eviction cancel in-flight fetches instead of
   *  letting them linger; an AbortError is discarded silently. */
  private aborts = new Map<string, AbortController>()
  private disposed = false
  private readonly maxEntries: number

  constructor(transport: WorkspaceDiffTransport, maxEntries = WORKSPACE_DIFF_MAX_ENTRIES) {
    this.transport = transport
    this.maxEntries = Math.max(1, maxEntries)
  }

  getScope = (): string | null => (this.disposed ? null : this.store.getSnapshot().scope)

  getDoc = (key: string): DiffDocEntry | undefined => {
    if (this.disposed) return undefined
    this.store.getSnapshot()
    const entry = this.entries.get(key)
    return entry !== undefined && 'diff' in entry ? entry : undefined
  }

  getList = (key: string): DiffListEntry | undefined => {
    if (this.disposed) return undefined
    this.store.getSnapshot()
    const entry = this.entries.get(key)
    return entry !== undefined && 'files' in entry ? entry : undefined
  }

  get = (key: string): DiffDocEntry | DiffListEntry | DiffImageEntry | undefined => {
    if (this.disposed) return undefined
    this.store.getSnapshot()
    return this.entries.get(key)
  }

  subscribe = this.store.subscribe

  /** Fingerprint for useSyncExternalStore: changes only when an entry changes. */
  fingerprint = (): string => {
    let fingerprint = `${this.entries.size}`
    for (const [key, entry] of this.entries) {
      fingerprint += `|${key}:${entry.phase}`
      if (entry.phase === 'ready') {
        if ('files' in entry) fingerprint += `:${entry.files?.length ?? 0}`
        else if ('data' in entry) fingerprint += `:img`
        else fingerprint += `:${entry.diff?.length ?? 0}`
      }
    }
    return fingerprint
  }

  setScope(scope: string | null): void {
    this.assertOpen()
    if (this.store.getSnapshot().scope === scope) return
    this.generation.next()
    this.abortAll()
    this.entries.clear()
    this.inflight.clear()
    this.store.setState({ scope })
  }

  ensureWorktreeList(staged: boolean): Promise<DiffListEntry> {
    return this.ensureEntry(
      worktreeListKey(staged),
      { phase: 'loading', files: null },
      signal => this.transport.loadWorktreeList(staged, signal)
        .then(files => ({ phase: 'ready' as const, files })),
    )
  }

  ensureWorktreeDoc(staged: boolean, filePath: string, context: number): Promise<DiffDocEntry> {
    return this.ensureEntry(
      worktreeDocKey(staged, filePath, context),
      { phase: 'loading', diff: null },
      signal => this.transport.loadWorktreeDoc(staged, filePath, context, signal)
        .then(diff => ({ phase: 'ready' as const, diff })),
    )
  }

  ensureCommitList(hash: string): Promise<DiffListEntry> {
    return this.ensureEntry(
      commitListKey(hash),
      { phase: 'loading', files: null },
      signal => this.transport.loadCommitList(hash, signal)
        .then(files => ({ phase: 'ready' as const, files })),
    )
  }

  ensureCommitDoc(hash: string, filePath: string): Promise<DiffDocEntry> {
    return this.ensureEntry(
      commitDocKey(hash, filePath),
      { phase: 'loading', diff: null },
      signal => this.transport.loadCommitDoc(hash, filePath, signal)
        .then(diff => ({ phase: 'ready' as const, diff })),
    )
  }

  ensureCommittedList(baseRef: string): Promise<DiffListEntry> {
    return this.ensureEntry(
      committedListKey(baseRef),
      { phase: 'loading', files: null },
      signal => this.transport.loadCommittedList(baseRef, signal)
        .then(files => ({ phase: 'ready' as const, files })),
    )
  }

  ensureCommittedDoc(baseRef: string, filePath: string): Promise<DiffDocEntry> {
    return this.ensureEntry(
      committedDocKey(baseRef, filePath),
      { phase: 'loading', diff: null },
      signal => this.transport.loadCommittedDoc(baseRef, filePath, signal)
        .then(diff => ({ phase: 'ready' as const, diff })),
    )
  }

  /** Re-load one worktree file with a wider context and swap it into the list. */
  async expandWorktreeFile(staged: boolean, filePath: string, context: number): Promise<DiffDocEntry> {
    const doc = await this.ensureWorktreeDoc(staged, filePath, context)
    if (doc.phase !== 'ready' || doc.diff === null) return doc
    const reparsed = parseGitReviewDiff(doc.diff)
    const nextFile = reparsed.find(candidate => candidate.path === filePath) ?? reparsed[0]
    if (nextFile !== undefined) this.replaceWorktreeFile(staged, nextFile)
    return doc
  }

  /** Replace one file inside a worktree list entry (expand-context swap). */
  replaceWorktreeFile(staged: boolean, file: GitReviewFile): void {
    this.assertOpen()
    const key = worktreeListKey(staged)
    const entry = this.entries.get(key)
    if (entry === undefined || !('files' in entry) || entry.files === null) return
    this.entries.set(key, {
      phase: 'ready',
      files: entry.files.map(candidate => candidate.path === file.path ? file : candidate),
    })
    this.emit()
  }

  invalidate(key: string): void {
    this.assertOpen()
    this.abort(key)
    this.entries.delete(key)
    this.inflight.delete(key)
    this.emit()
  }

  /**
   * Precise mutation invalidation (D20c / leaf-3.2 rev2): drop ONLY the
   * worktree diff list/docs (staged + unstaged), which a stage/unstage/
   * discard/commit/revert rewrites. Commit and committed projections are
   * immutable once yielded, so they are left cached — invalidating them here
   * would clear data.git didn't change.
   */
  invalidateWorktree(): void {
    this.assertOpen()
    let changed = false
    for (const key of [...this.entries.keys()]) {
      if (!key.startsWith('list:w:') && !key.startsWith('doc:w:') && !key.startsWith('img:w:')) continue
      this.abort(key)
      this.entries.delete(key)
      this.inflight.delete(key)
      changed = true
    }
    if (changed) this.emit()
  }

  /** Retained image-diff entry (null until loaded; error carries a message). */
  ensureImageDiff(staged: boolean, filePath: string, signal?: AbortSignal): Promise<DiffImageEntry> {
    return this.ensureEntry(
      worktreeImageKey(staged, filePath),
      { phase: 'loading', data: null },
      controllerSignal => this.transport.loadImageDiff(staged, filePath, controllerSignal)
        .then(data => ({ phase: 'ready' as const, data })),
    )
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation.next()
    this.abortAll()
    this.entries.clear()
    this.inflight.clear()
    this.store.dispose()
  }

  private async ensureEntry<E extends DiffDocEntry | DiffListEntry | DiffImageEntry>(
    key: string,
    placeholder: E,
    load: (signal?: AbortSignal) => Promise<E>,
  ): Promise<E> {
    this.assertOpen()
    const existing = this.entries.get(key)
    if (existing !== undefined && (existing.phase === 'ready' || existing.phase === 'error')) {
      this.touch(key, existing)
      return existing as E
    }
    const pending = this.inflight.get(key)
    if (pending !== undefined) {
      await pending
      return (this.entries.get(key) as E | undefined) ?? placeholder
    }
    const requestGeneration = this.generation.current()
    this.put(key, placeholder)
    this.emit()
    const request = this.loadEntry({ key, placeholder, load, requestGeneration })
    this.inflight.set(key, request)
    try {
      await request
    } finally {
      if (this.inflight.get(key) === request) this.inflight.delete(key)
    }
    return (this.entries.get(key) as E | undefined) ?? placeholder
  }

  private async loadEntry<E extends DiffDocEntry | DiffListEntry | DiffImageEntry>(input: {
    key: string
    placeholder: E
    load: (signal?: AbortSignal) => Promise<E>
    requestGeneration: number
  }): Promise<void> {
    const controller = new AbortController()
    this.aborts.set(input.key, controller)
    try {
      const result = await input.load(controller.signal)
      this.clearAbort(input.key)
      if (this.disposed || !this.generation.isCurrent(input.requestGeneration)) return
      this.put(input.key, result)
      this.emit()
    } catch (cause) {
      this.clearAbort(input.key)
      if (this.disposed || !this.generation.isCurrent(input.requestGeneration)) return
      // An aborted fetch (scope change / dispose / LRU eviction) is dropped
      // silently — never surfaced into the error phase (D7).
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      const message = errorMessage(cause)
      this.put(input.key, { ...input.placeholder, phase: 'error', message })
      this.emit()
    }
  }

  private put(key: string, entry: DiffDocEntry | DiffListEntry | DiffImageEntry): void {
    this.touch(key, entry)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      if (this.inflight.has(oldest)) break
      // LRU eviction cancels any in-flight fetch for the victim (D7).
      this.abort(oldest)
      this.entries.delete(oldest)
    }
  }

  private touch(key: string, entry: DiffDocEntry | DiffListEntry | DiffImageEntry): void {
    this.entries.delete(key)
    this.entries.set(key, entry)
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

  private emit(): void {
    this.store.setState(current => ({ ...current }))
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('WorkspaceDiffRuntime is disposed.')
  }
}

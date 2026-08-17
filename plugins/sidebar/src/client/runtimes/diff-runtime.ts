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
import { GenerationGate, RevisionedStore } from '@oh-dsh/shared/runtime'
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
  private entries = new Map<string, DiffDocEntry | DiffListEntry>()
  private inflight = new Map<string, Promise<void>>()
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

  subscribe = this.store.subscribe

  /** Fingerprint for useSyncExternalStore: changes only when an entry changes. */
  fingerprint = (): string => {
    let fingerprint = `${this.entries.size}`
    for (const [key, entry] of this.entries) {
      fingerprint += `|${key}:${entry.phase}`
      if (entry.phase === 'ready') {
        fingerprint += 'files' in entry ? `:${entry.files?.length ?? 0}` : `:${entry.diff?.length ?? 0}`
      }
    }
    return fingerprint
  }

  setScope(scope: string | null): void {
    this.assertOpen()
    if (this.store.getSnapshot().scope === scope) return
    this.generation.next()
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
    this.entries.delete(key)
    this.inflight.delete(key)
    this.emit()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation.next()
    this.entries.clear()
    this.inflight.clear()
    this.store.dispose()
  }

  private async ensureEntry<E extends DiffDocEntry | DiffListEntry>(
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

  private async loadEntry<E extends DiffDocEntry | DiffListEntry>(input: {
    key: string
    placeholder: E
    load: (signal?: AbortSignal) => Promise<E>
    requestGeneration: number
  }): Promise<void> {
    try {
      const result = await input.load()
      if (this.disposed || !this.generation.isCurrent(input.requestGeneration)) return
      this.put(input.key, result)
      this.emit()
    } catch (cause) {
      if (this.disposed || !this.generation.isCurrent(input.requestGeneration)) return
      const message = cause instanceof Error ? cause.message : String(cause)
      this.put(input.key, { ...input.placeholder, phase: 'error', message })
      this.emit()
    }
  }

  private put(key: string, entry: DiffDocEntry | DiffListEntry): void {
    this.touch(key, entry)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      if (this.inflight.has(oldest)) break
      this.entries.delete(oldest)
    }
  }

  private touch(key: string, entry: DiffDocEntry | DiffListEntry): void {
    this.entries.delete(key)
    this.entries.set(key, entry)
  }

  private emit(): void {
    this.store.setState(current => ({ ...current }))
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('WorkspaceDiffRuntime is disposed.')
  }
}

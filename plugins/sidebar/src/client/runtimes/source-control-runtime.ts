/**
 * Source-control runtime (ported from the reference project's
 * `cache/source-control-runtime.ts`, adapted to the desktop sidebar).
 *
 * Owns the Git panel data: workspace facts + git status + branch list +
 * commit history, as one revisioned snapshot. Key behaviours:
 * - `ensureLoaded()`: Ready snapshots short-circuit with zero network.
 * - `refresh()` is a SOFT revalidate: a Ready snapshot is never demoted to
 *   Loading — the previous rows stay visible until new data replaces them
 *   (kills the "switching back flashes loading" problem).
 * - GenerationGate discards stale responses when the scope changes.
 *
 * The runtime owns DATA only; UI chrome (collapsed sections/directories,
 * selection, mode) lives in the chrome store.
 */
import { RevisionedStore, GenerationGate } from '@dsh-studio/shared/runtime'
import { errorMessage } from '@dsh-studio/shared/errors'
import type { WorkspaceFacts, WorkspaceSnapshot } from '../../protocol.ts'
import { sidebarApi } from '../sidebar-api.ts'
import type {
  CapabilitiesGitLogEntry,
  CapabilitiesGitBranch,
  CapabilitiesGitStatus,
  CapabilitiesGitCommitFile,
  CapabilitiesGitCommitted,
} from '../sidebar-api.ts'
import { workspaceChangesFromWire } from '../sidebar-api.ts'
import type {
  CommitFilesState,
  CommittedState,
} from '../commit-files.tsx'

export type SourceControlRuntimePhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'not-repo'
  | 'error'

/** The Git panel snapshot plus the commit history (history is per-scope
 *  runtime data, not part of the wire WorkspaceSnapshot). */
export interface SourceControlWorkspaceSnapshot extends WorkspaceSnapshot {
  history: CapabilitiesGitLogEntry[]
  /** Authoritative remote and operation state fetched with Git status. */
  upstream: CapabilitiesGitStatus['upstream']
}

export interface SourceControlRuntimeSnapshot {
  phase: SourceControlRuntimePhase
  message: string | null
  /** The Git panel snapshot (null until the first successful load). */
  snapshot: SourceControlWorkspaceSnapshot | null
  /** Committed-changes projection (files in local commits ahead of the
   *  branch upstream), retained per-scope so a project switch or a refresh
   *  never leaks the previous project's committed list (D5/D8). */
  committed: CommittedState
}

/** The committed-files state type used across the runtime's lazy cache. */
export type { CommittedState }

/** The scope shape the runtime requires (the project cwd). */
export interface SourceControlScope {
  cwd: string
}

export interface SourceControlTransport {
  gitStatus(scope: SourceControlScope, signal?: AbortSignal): Promise<CapabilitiesGitStatus>
  gitBranch(scope: SourceControlScope, signal?: AbortSignal): Promise<CapabilitiesGitBranch>
  gitLog(scope: SourceControlScope, signal?: AbortSignal): Promise<CapabilitiesGitLogEntry[]>
  workspaceFacts(cwd: string, signal?: AbortSignal): Promise<WorkspaceFacts>
  gitCommittedFiles(scope: SourceControlScope, signal?: AbortSignal): Promise<CapabilitiesGitCommitted>
  gitCommitFiles(scope: SourceControlScope, hash: string, signal?: AbortSignal): Promise<CapabilitiesGitCommitFile[]>
}

export interface SourceControlRuntimeOptions {
  transport: SourceControlTransport
  /** Merge the workspace facts + git status into a WorkspaceSnapshot. */
  buildSnapshot?(input: {
    facts: WorkspaceFacts
    status: CapabilitiesGitStatus
    branch: CapabilitiesGitBranch
    history: CapabilitiesGitLogEntry[]
  }): SourceControlWorkspaceSnapshot
}

function defaultBuildSnapshot(input: {
  facts: WorkspaceFacts
  status: CapabilitiesGitStatus
  branch: CapabilitiesGitBranch
  history: CapabilitiesGitLogEntry[]
}): SourceControlWorkspaceSnapshot {
  const { facts, status, branch, history } = input
  if (facts.kind !== 'repository' || !status.isRepo) {
    return {
      ...facts,
      kind: 'directory',
      branch: null,
      branches: [],
      changes: [],
      history: [],
      upstream: status.upstream,
    }
  }
  return {
    ...facts,
    kind: 'repository',
    branch: status.branch ?? branch.current,
    branches: branch.names,
    changes: workspaceChangesFromWire(status.entries, status.stats),
    history,
    upstream: status.upstream,
  }
}

export class SourceControlRuntime {
  private readonly transport: SourceControlTransport
  private readonly buildSnapshot: NonNullable<SourceControlRuntimeOptions['buildSnapshot']>
  private readonly store = new RevisionedStore<SourceControlRuntimeSnapshot>({
    phase: 'idle',
    message: null,
    snapshot: null,
    committed: { status: 'none' },
  })
  /** Lazy per-commit file lists (expanded history rows), keyed by hashFull.
   *  Kept here instead of component state so the committed / commit-file
   *  caches invalidate together on scope change and mutation (D5/D8). */
  private readonly commitFilesByHash = new Map<string, CommitFilesState>()
  private readonly generation = new GenerationGate()
  private scope: SourceControlScope | null = null
  private inflight: Promise<void> | null = null
  private inflightCommitted: Promise<void> | null = null
  private inflightCommitFiles = new Map<string, Promise<void>>()
  private activeAbort: AbortController | null = null
  private disposed = false
  /** Fingerprint of the last fetched `git.status` + workspace facts, used
   *  by the polling path to skip the redundant branch/log fetches (D20b). */
  private lastStatusKey = ''
  /** Last known branch-name list, reused when a poll's status is unchanged. */
  private lastBranchNames: string[] | null = null

  constructor(options: SourceControlRuntimeOptions) {
    this.transport = options.transport
    this.buildSnapshot = options.buildSnapshot ?? defaultBuildSnapshot
  }

  getSnapshot = (): SourceControlRuntimeSnapshot => {
    if (this.disposed) return this.store.getSnapshot()
    return this.store.getSnapshot()
  }

  subscribe = this.store.subscribe

  /** Fingerprint for useSyncExternalStore. */
  fingerprint = (): string => {
    const snapshot = this.store.getSnapshot()
    const data = snapshot.snapshot
    let fingerprint = ''
    if (data === null) {
      fingerprint = `${snapshot.phase}:${snapshot.message ?? ''}`
    } else {
      fingerprint = [
        snapshot.phase,
        data.kind,
        data.branch ?? '',
        data.changes.length,
        data.history?.length ?? 0,
      ].join(':')
    }
    fingerprint += `|committed:${snapshot.committed.status}`
    if (snapshot.committed.status === 'ready') {
      fingerprint += `:${snapshot.committed.baseRef}:${snapshot.committed.entries.length}`
    } else if (snapshot.committed.status === 'error') {
      fingerprint += `:${snapshot.committed.error}`
    }
    for (const [hash, state] of this.commitFilesByHash) {
      fingerprint += `|cf:${hash}:${state.status}`
      if (state.status === 'ready') fingerprint += `:${state.entries.length}`
    }
    return fingerprint
  }

  setScope(scope: SourceControlScope | null): void {
    this.assertOpen()
    const current = this.scope
    if (current !== null && scope !== null
      && current.cwd === scope.cwd) {
      return
    }
    this.activeAbort?.abort()
    this.activeAbort = null
    this.scope = scope
    this.generation.next()
    this.inflight = null
    this.inflightCommitted = null
    this.inflightCommitFiles.clear()
    this.commitFilesByHash.clear()
    this.lastStatusKey = ''
    this.lastBranchNames = null
    if (scope === null) {
      this.store.setState({ phase: 'idle', message: null, snapshot: null, committed: { status: 'none' } })
      return
    }
    // Re-assert binding; a fresh scope starts a load (cached state from a
    // previous scope is dropped by the generation gate).
    this.store.setState({ phase: 'loading', message: null, snapshot: null, committed: { status: 'none' } })
    void this.ensureLoaded()
  }

  /** Load once when idle; Ready/NotRepo snapshots short-circuit (0 network). */
  async ensureLoaded(): Promise<void> {
    this.assertOpen()
    const snapshot = this.store.getSnapshot()
    if (snapshot.phase === 'ready' || snapshot.phase === 'not-repo') return
    if (this.inflight !== null) {
      await this.inflight
      return
    }
    const request = this.load()
    this.inflight = request
    try {
      await request
    } finally {
      if (this.inflight === request) this.inflight = null
    }
  }

  /**
   * Soft revalidate: a Ready snapshot stays Ready (old rows keep rendering)
   * while new data is fetched. `strict: true` (post-mutation) still keeps
   * the current rows visible — only an idle/error runtime goes back to
   * Loading.
   */
  async refresh(options: { strict?: boolean } = {}): Promise<void> {
    this.assertOpen()
    const snapshot = this.store.getSnapshot()
    if (snapshot.phase === 'idle' || snapshot.phase === 'error') {
      this.store.setState({ ...snapshot, phase: 'loading' })
    }
    const request = this.load()
    this.inflight = request
    try {
      await request
    } finally {
      if (this.inflight === request) this.inflight = null
    }
  }

  /** Drop cached data entirely (workspace switch / explicit reset). */
  reset(): void {
    this.assertOpen()
    this.activeAbort?.abort()
    this.activeAbort = null
    this.generation.next()
    this.inflight = null
    this.inflightCommitted = null
    this.inflightCommitFiles.clear()
    this.commitFilesByHash.clear()
    this.lastStatusKey = ''
    this.lastBranchNames = null
    this.store.setState({ phase: 'idle', message: null, snapshot: null, committed: { status: 'none' } })
  }

  /** Surface a mutation failure through the runtime error phase. */
  reportError(message: string): void {
    this.assertOpen()
    const current = this.store.getSnapshot()
    this.store.setState({ ...current, phase: 'error', message })
  }

  getCommitted = (): CommittedState => this.store.getSnapshot().committed

  /** Soft-reload the committed projection, preserving the last good results
   *  on a transient failure (D10 applies to committed too). */
  async refreshCommitted(signal?: AbortSignal): Promise<void> {
    this.assertOpen()
    const scope = this.scope
    if (scope === null) return
    const requestGeneration = this.generation.current()
    if (this.inflightCommitted !== null) {
      await this.inflightCommitted
      return
    }
    const request = (async () => {
      try {
        const result = await this.transport.gitCommittedFiles(scope, signal)
        if (this.disposed || !this.generation.isCurrent(requestGeneration)) return
        this.store.setState({
          ...this.store.getSnapshot(),
          committed: result.baseRef === null
            ? { status: 'none' }
            : { status: 'ready', baseRef: result.baseRef, entries: result.entries },
        })
      } catch (cause) {
        if (this.disposed || !this.generation.isCurrent(requestGeneration)) return
        const message = errorMessage(cause)
        this.store.setState({
          ...this.store.getSnapshot(),
          committed: { status: 'error', error: message },
        })
      }
    })()
    this.inflightCommitted = request
    try {
      await request
    } finally {
      if (this.inflightCommitted === request) this.inflightCommitted = null
    }
  }

  /** Invalidates the committed projection after a Git mutation (commit /
   *  push / branch change): the committed files recompute on next poll. */
  invalidateCommitted(): void {
    this.assertOpen()
    this.store.setState({
      ...this.store.getSnapshot(),
      committed: { status: 'none' },
    })
  }

  getCommitFiles = (hash: string): CommitFilesState | undefined =>
    this.disposed ? undefined : this.commitFilesByHash.get(hash)

  /** HashFull keys that have a materialized file-list cache entry. */
  listCommitFileHashes = (): readonly string[] =>
    this.disposed ? [] : [...this.commitFilesByHash.keys()]

  /** Lazy-load one commit's file list; Ready hits short-circuit. */
  async ensureCommitFiles(hash: string, signal?: AbortSignal): Promise<CommitFilesState> {
    this.assertOpen()
    const scope = this.scope
    const existing = this.commitFilesByHash.get(hash)
    if (existing !== undefined && (existing.status === 'ready' || existing.status === 'error')) {
      return existing
    }
    const pending = this.inflightCommitFiles.get(hash)
    if (pending !== undefined) {
      await pending
      return this.commitFilesByHash.get(hash) ?? { status: 'loading' }
    }
    const requestGeneration = this.generation.current()
    this.commitFilesByHash.set(hash, { status: 'loading' })
    this.emit()
    if (scope === null) return { status: 'loading' }
    const request = (async () => {
      try {
        const entries = await this.transport.gitCommitFiles(scope, hash, signal)
        if (this.disposed || !this.generation.isCurrent(requestGeneration)) return
        this.commitFilesByHash.set(hash, { status: 'ready', entries })
        this.emit()
      } catch (cause) {
        if (this.disposed || !this.generation.isCurrent(requestGeneration)) return
        const message = errorMessage(cause)
        this.commitFilesByHash.set(hash, { status: 'error', error: message })
        this.emit()
      }
    })()
    this.inflightCommitFiles.set(hash, request)
    try {
      await request
    } finally {
      if (this.inflightCommitFiles.get(hash) === request) this.inflightCommitFiles.delete(hash)
    }
    return this.commitFilesByHash.get(hash) ?? { status: 'loading' }
  }

  /** Drop one commit's cached file list (a commit's contents are immutable,
   *  so this is only needed for a scope change / explicit reset). */
  invalidateCommitFiles(hash: string): void {
    this.assertOpen()
    if (this.commitFilesByHash.delete(hash)) this.emit()
  }

  private emit(): void {
    this.store.setState(current => ({ ...current }))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.activeAbort?.abort()
    this.activeAbort = null
    this.generation.next()
    this.inflight = null
    this.inflightCommitted = null
    this.inflightCommitFiles.clear()
    this.commitFilesByHash.clear()
    this.lastStatusKey = ''
    this.lastBranchNames = null
    this.store.dispose()
  }

  private async load(): Promise<void> {
    const scope = this.scope
    if (scope === null) return
    const requestGeneration = this.generation.current()
    const current = this.store.getSnapshot()
    const phase = current.phase
    if (phase !== 'ready' && phase !== 'not-repo') {
      // D10 soft-fail (兑现 leaf-3.2 :180-185): a revalidate from idle/error must
      // NOT blank the last good rows — keep the prior snapshot during the
      // loading transition so the panel never flashes a white/error screen.
      this.store.setState({ ...current, phase: 'loading', message: null })
    }
    this.activeAbort?.abort()
    const controller = new AbortController()
    this.activeAbort = controller
    try {
      const [facts, status] = await Promise.all([
        this.transport.workspaceFacts(scope.cwd, controller.signal),
        this.transport.gitStatus(scope, controller.signal),
      ])
      if (this.disposed || !this.generation.isCurrent(requestGeneration)) return
      // D20b: when the status revision is identical to the last poll, skip
      // the heavyweight branch+log refetch — nothing could have changed the
      // history/remote view.
      const statusKey = [
        status.isRepo,
        status.branch ?? '',
        status.entries.map(e => `${e.xy}:${e.path}`).join('|'),
        status.upstream?.ahead ?? 0,
        status.upstream?.behind ?? 0,
        status.upstream?.hasUpstream ?? false,
      ].join(':')
      const changed = statusKey !== this.lastStatusKey
      this.lastStatusKey = statusKey
      let history: CapabilitiesGitLogEntry[] | null = null
      let branch: CapabilitiesGitBranch | null = null
      if (status.isRepo && facts.kind === 'repository'
        && (changed || this.lastBranchNames === null)) {
        const [nextBranch, nextHistory] = await Promise.all([
          this.transport.gitBranch(scope, controller.signal)
            .catch(cause => {
              // D21: don't swallow a branch-listing failure silently — log it
              // and resolve to null so the merge below falls back to the last
              // known branch instead of blanking.
              console.warn('[sidebar] git.branch failed, falling back', cause)
              return null
            }),
          this.transport.gitLog(scope, controller.signal)
            .catch(cause => {
              // D21: a history failure must not read as "no commits" — log it
              // and resolve to null so the merge below keeps the previous rows.
              console.warn('[sidebar] git.log failed, falling back', cause)
              return null
            }),
        ])
        if (nextBranch !== null) {
          branch = nextBranch
          this.lastBranchNames = nextBranch.names
        }
        if (nextHistory !== null) history = nextHistory
      }
      if (this.disposed || !this.generation.isCurrent(requestGeneration)) return
      // D20b completion: on an unchanged poll the fetch above is skipped, and
      // on a transient failure either call may resolve to null — both must
      // fall back to the previous snapshot's rows. Writing fresh defaults
      // here made every unchanged 4s poll wipe the commit history.
      const priorSnapshot = current.snapshot
      const snapshot = this.buildSnapshot({
        facts,
        status,
        branch: branch ?? {
          current: status.branch ?? 'HEAD',
          names: this.lastBranchNames ?? priorSnapshot?.branches ?? [],
        },
        history: history ?? priorSnapshot?.history ?? [],
      })
      this.store.setState({
        phase: snapshot.kind === 'repository' ? 'ready' : 'not-repo',
        message: null,
        snapshot,
        committed: this.store.getSnapshot().committed,
      })
    } catch (cause) {
      if (this.disposed || !this.generation.isCurrent(requestGeneration)) return
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      const message = errorMessage(cause)
      // D10 soft-fail: a single refresh/network failure must not demote a
      // ready panel to a blank error page — keep the last good rows visible
      // (they are fresher than an empty error screen).
      const prior = this.store.getSnapshot()
      this.store.setState({
        ...prior,
        phase: 'error',
        message,
        snapshot: prior.snapshot,
      })
    } finally {
      if (this.activeAbort === controller) {
        this.activeAbort = null
      }
    }
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('SourceControlRuntime is disposed.')
  }
}

/** Default transport over the sidebar API (git.* + workspace.facts). */
export function sidebarSourceControlTransport(): SourceControlTransport {
  return {
    gitStatus: (scope, signal) => sidebarApi.gitStatus(scope, signal),
    gitBranch: (scope, signal) => sidebarApi.gitBranch(scope, signal),
    gitLog: (scope, signal) => sidebarApi.gitLog(scope, 30, 0, signal),
    workspaceFacts: (cwd, signal) => sidebarApi.workspaceFacts(cwd, signal),
    gitCommittedFiles: (scope, signal) => sidebarApi.gitCommittedFiles(scope, signal),
    gitCommitFiles: (scope, hash, signal) => sidebarApi.gitCommitFiles(scope, hash, signal),
  }
}

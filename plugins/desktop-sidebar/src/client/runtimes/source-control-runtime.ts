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
import { RevisionedStore, GenerationGate } from '../../../../shared/runtime.ts'
import type { WorkspaceFacts, WorkspaceSnapshot } from '../../protocol.ts'
import { WORKSPACE_API_PATH } from '../../protocol.ts'
import { betterSidebarApi } from '../better-sidebar-api.ts'
import type {
  BetterSidebarGitLogEntry,
  BetterSidebarScope,
  BetterSidebarGitBranch,
  BetterSidebarGitStatus,
} from '../better-sidebar-api.ts'
import { workspaceChangesFromBetterSidebar } from '../better-sidebar-api.ts'

export type SourceControlRuntimePhase =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'not-repo'
  | 'error'

/** The Git panel snapshot plus the commit history (history is per-scope
 *  runtime data, not part of the wire WorkspaceSnapshot). */
export interface SourceControlWorkspaceSnapshot extends WorkspaceSnapshot {
  history: BetterSidebarGitLogEntry[]
}

export interface SourceControlRuntimeSnapshot {
  phase: SourceControlRuntimePhase
  message: string | null
  /** The Git panel snapshot (null until the first successful load). */
  snapshot: SourceControlWorkspaceSnapshot | null
}

export interface SourceControlTransport {
  gitStatus(scope: BetterSidebarScope, signal?: AbortSignal): Promise<BetterSidebarGitStatus>
  gitBranch(scope: BetterSidebarScope, signal?: AbortSignal): Promise<BetterSidebarGitBranch>
  gitLog(scope: BetterSidebarScope, signal?: AbortSignal): Promise<BetterSidebarGitLogEntry[]>
  workspaceFacts(cwd: string, signal?: AbortSignal): Promise<WorkspaceFacts>
}

/** The scope shape the runtime requires (cwd is mandatory here). */
export interface SourceControlScope {
  sessionId: string
  cwd: string
}

export interface SourceControlRuntimeOptions {
  transport: SourceControlTransport
  /** Merge the workspace facts + git status into a WorkspaceSnapshot. */
  buildSnapshot?(input: {
    facts: WorkspaceFacts
    status: BetterSidebarGitStatus
    branch: BetterSidebarGitBranch
    history: BetterSidebarGitLogEntry[]
  }): SourceControlWorkspaceSnapshot
}

function defaultBuildSnapshot(input: {
  facts: WorkspaceFacts
  status: BetterSidebarGitStatus
  branch: BetterSidebarGitBranch
  history: BetterSidebarGitLogEntry[]
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
    }
  }
  return {
    ...facts,
    kind: 'repository',
    branch: status.branch ?? branch.current,
    branches: branch.names,
    changes: workspaceChangesFromBetterSidebar(status.entries, status.stats),
    history,
  }
}

export class SourceControlRuntime {
  private readonly transport: SourceControlTransport
  private readonly buildSnapshot: NonNullable<SourceControlRuntimeOptions['buildSnapshot']>
  private readonly store = new RevisionedStore<SourceControlRuntimeSnapshot>({
    phase: 'idle',
    message: null,
    snapshot: null,
  })
  private readonly generation = new GenerationGate()
  private scope: SourceControlScope | null = null
  private inflight: Promise<void> | null = null
  private disposed = false

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
    if (data === null) return `${snapshot.phase}:${snapshot.message ?? ''}`
    return [
      snapshot.phase,
      data.kind,
      data.branch ?? '',
      data.changes.length,
      data.history?.length ?? 0,
    ].join(':')
  }

  setScope(scope: SourceControlScope | null): void {
    this.assertOpen()
    const current = this.scope
    if (current !== null && scope !== null
      && current.sessionId === scope.sessionId && current.cwd === scope.cwd) {
      return
    }
    this.scope = scope
    this.generation.next()
    this.inflight = null
    if (scope === null) {
      this.store.setState({ phase: 'idle', message: null, snapshot: null })
      return
    }
    // Re-assert binding; a fresh scope starts a load (cached state from a
    // previous scope is dropped by the generation gate).
    this.store.setState({ phase: 'loading', message: null, snapshot: null })
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
    this.generation.next()
    this.inflight = null
    this.store.setState({ phase: 'idle', message: null, snapshot: null })
  }

  /** Surface a mutation failure through the runtime error phase. */
  reportError(message: string): void {
    this.assertOpen()
    this.store.setState({ phase: 'error', message, snapshot: this.store.getSnapshot().snapshot })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation.next()
    this.inflight = null
    this.store.dispose()
  }

  private async load(): Promise<void> {
    const scope = this.scope
    if (scope === null) return
    const requestGeneration = this.generation.current()
    const phase = this.store.getSnapshot().phase
    if (phase !== 'ready' && phase !== 'not-repo') {
      this.store.setState({ phase: 'loading', message: null, snapshot: null })
    }
    try {
      const controller = new AbortController()
      const [facts, status] = await Promise.all([
        this.transport.workspaceFacts(scope.cwd, controller.signal),
        this.transport.gitStatus(scope, controller.signal),
      ])
      if (this.disposed || !this.generation.isCurrent(requestGeneration)) return
      let history: BetterSidebarGitLogEntry[] = []
      let branch: BetterSidebarGitBranch = { current: 'HEAD', names: [] }
      if (status.isRepo && facts.kind === 'repository') {
        const [nextBranch, nextHistory] = await Promise.all([
          this.transport.gitBranch(scope, controller.signal).catch(() => branch),
          this.transport.gitLog(scope, controller.signal).catch(() => []),
        ])
        branch = nextBranch
        history = nextHistory
      }
      if (this.disposed || !this.generation.isCurrent(requestGeneration)) return
      const snapshot = this.buildSnapshot({ facts, status, branch, history })
      this.store.setState({
        phase: snapshot.kind === 'repository' ? 'ready' : 'not-repo',
        message: null,
        snapshot,
      })
    } catch (cause) {
      if (this.disposed || !this.generation.isCurrent(requestGeneration)) return
      const message = cause instanceof Error ? cause.message : String(cause)
      this.store.setState({ phase: 'error', message, snapshot: null })
    }
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('SourceControlRuntime is disposed.')
  }
}

/** Default transport over the desktop sidebar API + workspace facts route. */
export function sidebarSourceControlTransport(): SourceControlTransport {
  return {
    gitStatus: (scope, signal) => betterSidebarApi.gitStatus(scope, signal),
    gitBranch: (scope, signal) => betterSidebarApi.gitBranch(scope, signal),
    gitLog: (scope, signal) => betterSidebarApi.gitLog(scope, 30, 0, signal),
    workspaceFacts: async (cwd: string, signal?: AbortSignal) => {
      const url = new URL(WORKSPACE_API_PATH, window.location.origin)
      url.searchParams.set('cwd', cwd)
      const init: RequestInit = { ...(signal === undefined ? {} : { signal }) }
      const response = await fetch(url.href, init)
      const payload = await response.json() as WorkspaceFacts & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? `workspace facts failed (${String(response.status)})`)
      }
      return payload
    },
  }
}

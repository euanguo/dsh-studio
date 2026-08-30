/**
 * Small retained runtime for the Subagent panel's background-jobs actions
 * (output replay + kill). Holds per-`jobId` ResourceState entries keyed by
 * `sessionId:jobId`, so a job in one session can never leak its output into
 * another session's list (the "dual-key invalidation" requirement: both the
 * session scope AND the job id must match before a stale response is applied).
 *
 * This is intentionally a lightweight domain ("jobs 小域" in the leaf-3.2
 * gate): the actual job list comes from the harness's `sessions` push mirror
 * (`jobsBySession`); this runtime only owns the transient per-action UI
 * state that used to live in `useState` mirrors (outputs/killing maps).
 */
import { GenerationGate, RevisionedStore } from '@dsh-studio/shared/runtime'
import { sidebarApi, type CapabilitiesScope } from '../sidebar-api.ts'
import type { Translate } from '@dsh-studio/shared/i18n'
import { errorMessage } from '@dsh-studio/shared/errors'
import type { WorkspaceMessage } from '../i18n.ts'

/** Per-job output state — a ResourceState over the replayed text. */
export type JobOutputState =
  | Readonly<{ status: 'idle'; text: string | null }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; text: string }>
  | Readonly<{ status: 'error'; message: string }>

export interface SubagentJobsRuntimeSnapshot {
  /** sessionId:jobId → output state. */
  outputs: ReadonlyMap<string, JobOutputState>
  /** sessionId:jobId → true while a kill is in flight. */
  killing: ReadonlySet<string>
}

export interface JobsRuntimeTransport {
  jobOutput(scope: CapabilitiesScope, id: string, signal?: AbortSignal): Promise<{ text: string }>
  jobKill(scope: CapabilitiesScope, id: string): Promise<unknown>
}

function keyOf(sessionId: string, jobId: string): string {
  return `${sessionId}:${jobId}`
}

export class SubagentJobsRuntime {
  private readonly transport: JobsRuntimeTransport
  private readonly store = new RevisionedStore<SubagentJobsRuntimeSnapshot>({
    outputs: new Map(),
    killing: new Set(),
  })
  private readonly generation = new GenerationGate()
  private scope: CapabilitiesScope | null = null
  private sessionId: string | null = null
  private inflightOutput = new Map<string, Promise<void>>()
  private disposed = false

  constructor(transport: JobsRuntimeTransport) {
    this.transport = transport
  }

  getSnapshot = (): SubagentJobsRuntimeSnapshot => this.store.getSnapshot()

  subscribe = this.store.subscribe

  setScope(scope: CapabilitiesScope | null, sessionId: string | null): void {
    this.assertOpen()
    if (this.scope === scope
      && this.scope !== null && this.sessionId === sessionId) {
      return
    }
    this.generation.next()
    this.inflightOutput.clear()
    this.scope = scope
    this.sessionId = sessionId
    this.store.setState({ outputs: new Map(), killing: new Set() })
  }

  getOutput = (sessionId: string, jobId: string): JobOutputState | undefined =>
    this.disposed ? undefined : this.store.getSnapshot().outputs.get(keyOf(sessionId, jobId))

  isKilling = (sessionId: string, jobId: string): boolean =>
    this.disposed ? false : this.store.getSnapshot().killing.has(keyOf(sessionId, jobId))

  /** Replay one job's output, guarding stale responses by jobId+session. */
  async readOutput(sessionId: string, jobId: string, t: Translate<WorkspaceMessage>): Promise<void> {
    this.assertOpen()
    const scope = this.scope
    if (scope === null) return
    const key = keyOf(sessionId, jobId)
    const requestGeneration = this.generation.current()
    this.patchOutputs(outputs => outputs.set(key, { status: 'loading' }))
    const request = (async () => {
      try {
        const result = await this.transport.jobOutput(scope, jobId)
        if (this.disposed || !this.generation.isCurrent(requestGeneration)) return
        this.patchOutputs(outputs => outputs.set(key, {
          status: 'ready',
          text: result.text === '' ? t('subagent.job-output-empty') : result.text,
        }))
      } catch (cause) {
        if (this.disposed || !this.generation.isCurrent(requestGeneration)) return
        this.patchOutputs(outputs => outputs.set(key, {
          status: 'error',
          message: errorMessage(cause),
        }))
      }
    })()
    this.inflightOutput.set(key, request)
    try {
      await request
    } finally {
      if (this.inflightOutput.get(key) === request) this.inflightOutput.delete(key)
    }
  }

  /** Kill one job, tracking the in-flight state so the button disables. */
  async kill(sessionId: string, jobId: string): Promise<void> {
    this.assertOpen()
    const scope = this.scope
    if (scope === null) return
    const key = keyOf(sessionId, jobId)
    const requestGeneration = this.generation.current()
    this.patchKilling(killing => { killing.add(key) })
    try {
      await this.transport.jobKill(scope, jobId)
    } catch (cause) {
      // D21: a failed kill must not be a silent no-op — log it so the user
      // can retry or escalate.
      console.warn(`[sidebar] jobs.kill failed for ${jobId}`, cause)
    } finally {
      if (this.disposed || !this.generation.isCurrent(requestGeneration)) return
      this.patchKilling(killing => { killing.delete(key) })
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation.next()
    this.inflightOutput.clear()
    this.store.dispose()
  }

  private patchOutputs(update: (outputs: Map<string, JobOutputState>) => void): void {
    const outputs = new Map(this.store.getSnapshot().outputs)
    update(outputs)
    this.store.setState({ ...this.store.getSnapshot(), outputs })
  }

  private patchKilling(update: (killing: Set<string>) => void): void {
    const killing = new Set(this.store.getSnapshot().killing)
    update(killing)
    this.store.setState({ ...this.store.getSnapshot(), killing })
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('SubagentJobsRuntime is disposed.')
  }
}

/** Default transport over the sidebar API (jobs.output / jobs.kill). */
export function sidebarJobsTransport(t: Translate<WorkspaceMessage>): JobsRuntimeTransport {
  return {
    jobOutput: (scope, id) => sidebarApi.jobOutput(scope, id),
    jobKill: (scope, id) => sidebarApi.jobKill(scope, id),
  }
}
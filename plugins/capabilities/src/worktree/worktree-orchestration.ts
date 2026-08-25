/**
 * Host-side WorkTree topology and delegation orchestration.
 *
 * This module is the single owner of the WorkTree → Workspace → Session
 * relationship used by model-facing tools. Git remains in shared/git-core;
 * WorkspaceRegistry remains the durable workspace authority; AgentRegistry
 * remains the runtime agent factory. The orchestration layer only composes
 * those existing authorities and owns delegation lifecycle state.
 */
import { randomUUID } from 'node:crypto'
import { realpath, mkdir } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { homedir } from 'node:os'
import type {
  CapabilitiesAgent,
  CapabilitiesAgentHandle,
  CapabilitiesAgentOptions,
  CapabilitiesUserMessage,
  CapabilitiesDelegationAgent,
  CapabilitiesLiveSession,
  CapabilitiesWorkspace,
  Context,
} from '../context-types.ts'
import * as git from '@dsh-studio/shared/git-core'
import { isWithin } from '@dsh-studio/shared/fs-tree'
import { LEFT_RAIL_SETTINGS_NS } from '@dsh-studio/shared/left-rail-preferences'
import { errorMessage } from '@dsh-studio/shared/errors'
import {
  computeWorktreeLocation,
  resolveDefaultWorktreeRoot,
  sanitizeWorktreeDir,
  type WorktreeDefaultsResult,
} from '@dsh-studio/shared/worktree-preferences'

const PLUGIN_SOURCE = 'dsh-studio-capabilities'
const RESULT_LIMIT = 24_000
const SUMMARY_LIMIT = 180

type DelegationState = 'starting' | 'running' | 'completed' | 'aborted' | 'failed'

type TurnReason = { kind?: string; error?: { message?: string } }

export interface DelegationSnapshot {
  readonly id: string
  readonly parentSessionId: string
  readonly sessionId: string
  readonly worktreePath: string
  readonly prompt: string
  readonly state: DelegationState
  readonly startedAt: number
  readonly finishedAt?: number
  readonly stopReason?: string
  readonly result?: string
  readonly error?: string
}

export interface WorktreeSessionSnapshot {
  readonly id: string
  readonly cwd?: string
  readonly running: boolean
  readonly title: string
}

export interface WorktreeTopologyEntry {
  readonly path: string
  readonly branch: string | null
  readonly head: string | null
  readonly main: boolean
  readonly sessions: readonly WorktreeSessionSnapshot[]
}

export interface WorktreeProjectSnapshot {
  readonly repoRoot: string
  readonly worktrees: readonly WorktreeTopologyEntry[]
}

interface DelegationRecord extends DelegationSnapshot {
  readonly parent: CapabilitiesDelegationAgent
  readonly handle: CapabilitiesAgentHandle
  readonly firstSeq: number
  readonly agent?: CapabilitiesDelegationAgent
  readonly workspace?: CapabilitiesWorkspace
}

function textOfAssistantMessage(value: unknown): string {
  if (typeof value !== 'object' || value === null) return ''
  const message = value as { content?: unknown }
  if (!Array.isArray(message.content)) return ''
  return message.content
    .filter((block): block is { type: 'text'; text: string } => (
      typeof block === 'object'
      && block !== null
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string'
    ))
    .map(block => block.text)
    .join('')
}

function assistantOutput(events: readonly { seq: number; type: string; data: Record<string, unknown> }[], firstSeq: number): string {
  let text = ''
  for (const event of events) {
    if (event.seq < firstSeq || event.type !== 'assistant/message') continue
    const next = textOfAssistantMessage(event.data.message)
    if (next !== '') text = next
  }
  return text.slice(0, RESULT_LIMIT)
}

function turnReason(events: readonly { seq: number; type: string; data: Record<string, unknown> }[], firstSeq: number): TurnReason | undefined {
  let reason: TurnReason | undefined
  for (const event of events) {
    if (event.seq < firstSeq || event.type !== 'turn/end') continue
    reason = (event.data.reason ?? {}) as TurnReason
  }
  return reason
}

function summaryOf(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length <= SUMMARY_LIMIT
    ? normalized
    : `${normalized.slice(0, SUMMARY_LIMIT - 1)}…`
}

async function makeMessage(
  text: string,
  source: Record<string, unknown>,
): Promise<CapabilitiesUserMessage> {
  const module = await import('@deepseek-ai/dsh-llm') as unknown as {
    createUserMessage(input: { content: readonly unknown[]; source: Record<string, unknown> }): CapabilitiesUserMessage
  }
  return module.createUserMessage({
    content: [{ type: 'text', text }],
    source,
  })
}

function stateFromReason(reason: TurnReason | undefined): DelegationState {
  if (reason?.kind === 'completed') return 'completed'
  if (reason?.kind === 'aborted') return 'aborted'
  return 'failed'
}

function reasonText(reason: TurnReason | undefined): string {
  if (reason?.kind === 'completed') return 'completed'
  if (reason?.kind === 'aborted') return 'aborted'
  if (reason?.kind === 'blocked') return 'blocked'
  if (reason?.kind === 'max-tokens') return 'max-tokens'
  if (reason?.error?.message !== undefined) return reason.error.message
  return reason?.kind ?? 'error'
}

function pathKey(path: string): string {
  return resolve(path).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
}

function pathMatches(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right)
}

function agentOf(value: CapabilitiesAgent | undefined): CapabilitiesDelegationAgent | undefined {
  return value as CapabilitiesDelegationAgent | undefined
}

export class WorktreeDelegationRegistry {
  private readonly records = new Map<string, DelegationRecord>()
  private readonly stopSessionEvents: () => void
  private readonly ctx: Context

  constructor(ctx: Context) {
    this.ctx = ctx
    this.stopSessionEvents = ctx.on('session/event', (session, event) => {
      const sessionId = typeof (session as { id?: unknown })?.id === 'string'
        ? (session as { id: string }).id
        : undefined
      if (sessionId === undefined) return
      for (const record of this.records.values()) {
        if (record.sessionId !== sessionId || event.type !== 'turn/start') continue
        if (record.state === 'starting') this.replace(record.id, { state: 'running' })
      }
    })
  }

  dispose(): void {
    this.stopSessionEvents()
    for (const record of this.records.values()) {
      if (record.agent !== undefined && record.agent.status === 'running') {
        record.agent.cancel({ kind: 'disposed' })
      }
      void record.handle.dispose()
    }
    this.records.clear()
  }

  defaults(): WorktreeDefaultsResult {
    const descriptor = this.ctx.settings.describe({ redactSecrets: true })
      .find(candidate => candidate.ns === LEFT_RAIL_SETTINGS_NS)
    const record = descriptor?.value !== null && typeof descriptor?.value === 'object'
      ? descriptor.value as Record<string, unknown>
      : {}
    const custom = sanitizeWorktreeDir(record.worktreeDir)
    return {
      root: custom ?? resolveDefaultWorktreeRoot(process.env, homedir()),
      nest: record.nestWorktrees !== false,
      custom: custom !== undefined,
    }
  }

  async visiblePaths(parentSessionId: string): Promise<readonly string[]> {
    const parent = this.requireParent(parentSessionId)
    const paths = new Map<string, string>()
    const add = (path: string | undefined): void => {
      if (path === undefined || path === '') return
      paths.set(pathKey(path), path)
    }
    add(parent.session.header.cwd)
    for (const workspace of this.ctx.workspaceRegistry.list()) add(workspace.path)
    const cwd = parent.session.header.cwd
    if (cwd !== undefined) {
      const layout = await git.worktreeList(cwd).catch(() => null)
      for (const worktree of layout?.worktrees ?? []) add(worktree.path)
    }
    return [...paths.values()]
  }

  async assertVisible(parentSessionId: string, targetPath: string): Promise<string> {
    const canonical = await realpath(targetPath)
    const visible = await this.visiblePaths(parentSessionId)
    if (!visible.some(path => pathMatches(path, canonical))) {
      throw new Error('the target worktree is not a visible workspace or linked worktree')
    }
    return canonical
  }

  async assertVisibleRepository(parentSessionId: string, repositoryPath: string): Promise<string> {
    const canonical = await realpath(repositoryPath)
    const visible = await this.visiblePaths(parentSessionId)
    if (visible.some(path => pathMatches(path, canonical))) return canonical
    const layout = await git.worktreeList(canonical).catch(() => null)
    if (layout !== null && visible.some(path => pathMatches(path, layout.repoRoot))) return canonical
    throw new Error('the repository is not a visible workspace or linked worktree')
  }

  async createWorktree(
    parentSessionId: string,
    input: {
      repoCwd?: string
      path?: string
      branch: string
      createBranch?: boolean
      base?: string
    },
  ): Promise<{
    path: string
    branch: string
    workspaceId: string
    layout: git.GitWorktreeLayout | null
  }> {
    const parent = this.requireParent(parentSessionId)
    const repoCwd = await this.assertVisibleRepository(
      parentSessionId,
      input.repoCwd ?? parent.session.header.cwd ?? process.cwd(),
    )
    const repoRoot = await git.repoRoot(repoCwd)
    const defaults = this.defaults()
    const targetPath = input.path === undefined || input.path.trim() === ''
      ? computeWorktreeLocation({
        root: defaults.root,
        nest: defaults.nest,
        repoRoot,
        name: input.branch,
      })
      : resolve(input.path)
    const targetParent = resolve(targetPath, '..')
    if (!isWithin(defaults.root, targetPath) && !pathMatches(targetParent, defaults.root)) {
      throw new Error('new worktrees must be created below the DSH Studio worktree store')
    }
    const createBranch = input.createBranch === true
    await mkdir(targetParent, { recursive: true })
    const [canonicalRoot, canonicalParent] = await Promise.all([
      realpath(defaults.root),
      realpath(targetParent),
    ])
    if (!isWithin(canonicalRoot, canonicalParent)) {
      throw new Error('new worktrees must be created below the DSH Studio worktree store')
    }
    await git.worktreeAdd(repoCwd, targetPath, input.branch, createBranch, createBranch ? input.base : undefined)
    let workspace: CapabilitiesWorkspace
    try {
      workspace = await this.ctx.workspaceRegistry.create(targetPath, basename(targetPath))
    } catch (error) {
      await git.worktreeRemove(repoCwd, targetPath, true).catch(() => {})
      throw error
    }
    const layout = await git.worktreeList(repoCwd)
    return { path: targetPath, branch: input.branch, workspaceId: workspace.id, layout }
  }

  async removeWorktree(
    parentSessionId: string,
    repoCwd: string,
    targetPath: string,
    force: boolean,
  ): Promise<{ layout: git.GitWorktreeLayout | null }> {
    const repo = await this.assertVisibleRepository(parentSessionId, repoCwd)
    const target = await this.assertVisible(parentSessionId, targetPath)
    const workspaces = this.ctx.workspaceRegistry.list()
      .filter(candidate => isWithin(target, candidate.path))
    if (workspaces.some(workspace => workspace.sessionIds.some(id => {
      const agent = this.ctx.agents.get(id)
      return agent?.status === 'running'
    }))) {
      throw new Error('a running session must be stopped before removing this worktree')
    }
    const result = await git.worktreeRemove(repo, target, force)
    await Promise.all(workspaces.map(workspace => this.ctx.workspaceRegistry.delete(workspace.id)))
    return { layout: result }
  }

  async listTopology(parentSessionId: string, repoCwd?: string): Promise<readonly WorktreeProjectSnapshot[]> {
    const parent = this.requireParent(parentSessionId)
    const visible = await this.visiblePaths(parentSessionId)
    const roots = repoCwd === undefined
      ? visible
      : [await this.assertVisibleRepository(parentSessionId, repoCwd)]
    const layouts = new Map<string, git.GitWorktreeLayout>()
    for (const cwd of roots) {
      const layout = await git.worktreeList(cwd).catch(() => null)
      if (layout !== null) layouts.set(pathKey(layout.repoRoot), layout)
    }
    if (layouts.size === 0 && parent.session.header.cwd !== undefined) {
      const layout = await git.worktreeList(parent.session.header.cwd).catch(() => null)
      if (layout !== null) layouts.set(pathKey(layout.repoRoot), layout)
    }
    const workspaces = this.ctx.workspaceRegistry.list()
    const projects: WorktreeProjectSnapshot[] = []
    for (const layout of layouts.values()) {
      const entries = layout.worktrees.map(worktree => {
        const sessions = new Map<string, WorktreeSessionSnapshot>()
        for (const workspace of workspaces) {
          if (!isWithin(worktree.path, workspace.path)) continue
          for (const id of workspace.sessionIds) {
            const session = this.ctx.sessions.get(id)
            const agent = this.ctx.agents.get(id)
            const cwd = session?.header.cwd
            sessions.set(id, {
              id,
              ...(cwd === undefined ? {} : { cwd }),
              running: agent?.status === 'running',
              title: id,
            })
          }
        }
        if (isWithin(worktree.path, parent.session.header.cwd ?? '')) {
          const cwd = parent.session.header.cwd
          sessions.set(parent.id, {
            id: parent.id,
            ...(cwd === undefined ? {} : { cwd }),
            running: parent.status === 'running',
            title: parent.id,
          })
        }
        return {
          path: worktree.path,
          branch: worktree.branch,
          head: worktree.head,
          main: worktree.main,
          sessions: [...sessions.values()],
        }
      })
      projects.push({ repoRoot: layout.repoRoot, worktrees: entries })
    }
    return projects
  }

  status(parentSessionId: string, targetPath: string): Promise<{
    path: string
    branch: string
    status: Awaited<ReturnType<typeof git.statusV2>>
  }> {
    return this.assertVisible(parentSessionId, targetPath).then(async path => ({
      path,
      branch: await git.currentBranch(path),
      status: await git.statusV2(path),
    }))
  }

  branches(parentSessionId: string, repoCwd?: string): Promise<{ current: string; names: string[] }> {
    const parent = this.requireParent(parentSessionId)
    return this.assertVisibleRepository(parentSessionId, repoCwd ?? parent.session.header.cwd ?? process.cwd())
      .then(path => git.branches(path))
  }

  async start(parentSessionId: string, worktreePath: string, prompt: string, agentOptions?: CapabilitiesAgentOptions): Promise<DelegationSnapshot> {
    const parent = this.requireParent(parentSessionId)
    const target = await this.assertVisible(parentSessionId, worktreePath)
    const id = `worktree-${randomUUID()}`
    const sessionId = id
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: {
        cwd: target,
        parentSession: parent.id,
        origin: 'subagent',
        delegationDepth: (parent.session.header.delegationDepth ?? 0) + 1,
      },
      agentOptions: agentOptions ?? parent.options,
      ...(parent.ctx === undefined ? {} : {
        setup: (childCtx: { get(name: string): unknown }) => {
          const presets = parent.ctx?.get('agentPresets') as {
            composeFrom?(child: unknown, parent: unknown): void
          } | undefined
          presets?.composeFrom?.(childCtx, parent.ctx)
        },
      }),
    })
    const workspace = await this.ctx.workspaceRegistry.create(target, basename(target))
    await workspace.attachSession(sessionId)
    const record: DelegationRecord = {
      id,
      parentSessionId: parent.id,
      sessionId: id,
      worktreePath: target,
      prompt,
      state: 'starting',
      startedAt: Date.now(),
      parent,
      handle,
      firstSeq: handle.agent.session.seq,
      agent: handle.agent,
      workspace,
    }
    this.records.set(id, record)
    void makeMessage(prompt, { kind: 'user' }).then(message => {
      handle.agent?.followup(message)
      void this.drive(record)
    }, error => {
      this.replace(id, {
        state: 'failed',
        finishedAt: Date.now(),
        stopReason: 'error',
        error: errorMessage(error),
      })
      const failed = this.records.get(id)
      if (failed !== undefined) void this.notifyParent(failed)
    })
    return this.snapshot(record)
  }

  list(parentSessionId: string): readonly DelegationSnapshot[] {
    return [...this.records.values()]
      .filter(record => record.parentSessionId === parentSessionId)
      .map(record => this.snapshot(record))
  }

  get(parentSessionId: string, id: string): DelegationSnapshot {
    const record = this.requireOwned(parentSessionId, id)
    return this.snapshot(record)
  }

  async wait(parentSessionId: string, id: string, timeoutMs: number): Promise<DelegationSnapshot> {
    const record = this.requireOwned(parentSessionId, id)
    if (record.state !== 'starting' && record.state !== 'running') return this.snapshot(record)
    const deadline = Date.now() + Math.max(100, Math.min(timeoutMs, 300_000))
    while (record.state === 'starting' || record.state === 'running') {
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      await new Promise<void>(resolvePromise => setTimeout(resolvePromise, Math.min(remaining, 100)))
    }
    return this.snapshot(record)
  }

  stop(parentSessionId: string, id: string): DelegationSnapshot {
    const record = this.requireOwned(parentSessionId, id)
    if (record.agent !== undefined && (record.state === 'starting' || record.state === 'running')) {
      record.agent.cancel({ kind: 'user' })
    }
    return this.snapshot(record)
  }

  private async drive(record: DelegationRecord): Promise<void> {
    try {
      if (record.agent === undefined) throw new Error('delegated agent was not published')
      this.replace(record.id, { state: 'running' })
      await record.agent.whenIdle()
      await this.ctx.sessions.flush(record.agent.session)
      const events = record.agent.session.events
      const firstSeq = record.firstSeq
      const reason = turnReason(events, firstSeq)
      const result = assistantOutput(events, firstSeq)
      this.replace(record.id, {
        state: stateFromReason(reason),
        finishedAt: Date.now(),
        stopReason: reasonText(reason),
        ...(result === '' ? {} : { result }),
      })
    } catch (error) {
      this.replace(record.id, {
        state: 'failed',
        finishedAt: Date.now(),
        stopReason: 'error',
        error: errorMessage(error),
      })
    }
    const settled = this.records.get(record.id)
    if (settled !== undefined) void this.notifyParent(settled)
  }

  private async notifyParent(record: DelegationRecord): Promise<void> {
    const detail = record.error ?? record.result ?? record.stopReason ?? record.state
    const summary = `WorkTree delegation ${record.id} ${record.state}: ${summaryOf(detail)}`
    try {
      const message = await makeMessage(
        `[WorkTree delegation callback]\nworktree: ${record.worktreePath}\nstate: ${record.state}\nresult: ${detail}`,
        {
          kind: 'plugin',
          plugin: PLUGIN_SOURCE,
          form: 'notice',
          summary,
        },
      )
      record.parent.followup(message)
    } catch {
      // The parent may have been disposed after delegation; the durable child
      // session and registry result remain available to explicit status calls.
    }
  }

  private requireParent(parentSessionId: string): CapabilitiesDelegationAgent {
    const parent = agentOf(this.ctx.agents.get(parentSessionId))
    if (parent === undefined) throw new Error(`initiating agent "${parentSessionId}" is not live`)
    return parent
  }

  private requireOwned(parentSessionId: string, id: string): DelegationRecord {
    const record = this.records.get(id)
    if (record === undefined) throw new Error(`unknown WorkTree delegation "${id}"`)
    if (record.parentSessionId !== parentSessionId) throw new Error('delegation belongs to another session')
    return record
  }

  private snapshot(record: DelegationRecord): DelegationSnapshot {
    return {
      id: record.id,
      parentSessionId: record.parentSessionId,
      sessionId: record.sessionId,
      worktreePath: record.worktreePath,
      prompt: record.prompt,
      state: record.state,
      startedAt: record.startedAt,
      ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
      ...(record.stopReason === undefined ? {} : { stopReason: record.stopReason }),
      ...(record.result === undefined ? {} : { result: record.result }),
      ...(record.error === undefined ? {} : { error: record.error }),
    }
  }

  private replace(id: string, patch: Partial<DelegationRecord>): void {
    const current = this.records.get(id)
    if (current === undefined) return
    this.records.set(id, { ...current, ...patch })
  }
}

// unwired-capability: restored from HEAD. Worktree location for a session is
// now tracked through the worktree delegation records above rather than this
// projection helper, so nothing in the tree references it. Kept exported
// (same HEAD signature) for external callers; it is not part of the wired
// worktree flow.
export function worktreeSessionPathOf(session: CapabilitiesLiveSession): string | undefined {
  return session.header.cwd
}

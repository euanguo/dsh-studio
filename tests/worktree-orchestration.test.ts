import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'
import {
  WorktreeDelegationRegistry,
  type WorktreeDelegationRegistryOptions,
} from '../plugins/capabilities/src/worktree/worktree-orchestration.ts'

const execFile = promisify(execFileCallback)

async function makeRepository(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-capabilities-worktree-'))
  await execFile('git', ['init', '-q', root])
  await execFile('git', ['-C', root, 'config', 'user.email', 'test@example.invalid'])
  await execFile('git', ['-C', root, 'config', 'user.name', 'DSH Test'])
  await mkdir(`${root}/src`)
  await writeFile(`${root}/src/.keep`, '')
  await execFile('git', ['-C', root, 'add', '.'])
  await execFile('git', ['-C', root, 'commit', '-qm', 'initial'])
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

function fakeContext(parentCwd: string, workspaces: { path: string; sessionIds: readonly string[] }[] = []) {
  const parent = {
    id: 'parent-session',
    status: 'idle' as const,
    options: {},
    session: {
      id: 'parent-session',
      header: { cwd: parentCwd, delegationDepth: 0 },
      events: [],
      seq: 0,
    },
    followup: () => {},
    whenIdle: async () => {},
    cancel: () => {},
  }
  return {
    parent,
    context: {
      on: () => () => {},
      settings: { describe: () => [] },
      sessions: { get: () => undefined, list: () => [], create: () => undefined, flush: async () => true },
      workspaceRegistry: {
        list: () => workspaces,
        create: async (path: string) => ({
          id: `workspace:${path}`,
          path,
          title: path,
          sessionIds: [],
          attachSession: async () => {},
        }),
        resolveByPath: async () => undefined,
        delete: async () => true,
      },
      agents: {
        get: (id: string) => id === parent.id ? parent : undefined,
        create: async () => { throw new Error('not used in this test') },
      },
    },
  }
}

const stubUserMessage: NonNullable<WorktreeDelegationRegistryOptions['createUserMessage']> = async (text, source) => ({
  id: `msg-${text.length}-${JSON.stringify(source)}`,
  role: 'user',
  content: [{ type: 'text', text }],
  source,
})

/**
 * Scripted delegation runtime: the created child agent completes one turn
 * synchronously inside followup() (appending the same events the real loop
 * would), so the registry's drive() path settles without a model.
 */
async function delegationHarness({
  parentCwd,
  parentDepth = 0,
  failWorkspaceCreate = false,
  resultText = 'done',
  reason = 'completed',
  stuckAgent = false,
  deferPrompt = false,
}: {
  parentCwd?: string
  parentDepth?: number
  failWorkspaceCreate?: boolean
  resultText?: string
  reason?: string
  stuckAgent?: boolean
  deferPrompt?: boolean
} = {}) {
  // The harness must be async-friendly: canonicalize via realpath in the test
  // (macOS tmpdir /var/... is a symlink spelling; a non-git dir has no
  // git-reported canonical alias for visibility matching).
  const repo = await realpath(parentCwd ?? await mkdtemp(join(tmpdir(), 'dsh-delegation-harness-')))
  const createdAgents: { id: string; meta: unknown; followups: unknown[]; disposed: number }[] = []
  const childAgent = (id: string) => {
    const agent = {
      id,
      status: 'idle' as 'idle' | 'running',
      options: {},
      session: {
        id,
        header: { cwd: undefined as string | undefined },
        events: [] as { type: string; seq: number; time: number; data: Record<string, unknown> }[],
        seq: 0,
      },
      followup(message: unknown) {
        agent.followups.push(message)
        agent.status = 'running'
        agent.session.events.push({ type: 'turn/start', seq: ++agent.session.seq, time: Date.now(), data: { turn: 1 } })
        if (stuckAgent) return
        agent.session.events.push({
          type: 'assistant/message',
          seq: ++agent.session.seq,
          time: Date.now(),
          data: { message: { content: [{ type: 'text', text: resultText }] } },
        })
        agent.session.events.push({ type: 'turn/end', seq: ++agent.session.seq, time: Date.now(), data: { turn: 1, reason: { kind: reason } } })
        agent.status = 'idle'
      },
      followups: [] as unknown[],
      whenIdle: stuckAgent ? () => new Promise<void>(() => {}) : async () => {},
      cancel: () => {},
    }
    return agent
  }
  const parent = {
    id: 'parent-session',
    status: 'idle' as const,
    options: {},
    session: {
      id: 'parent-session',
      header: { cwd: repo, delegationDepth: parentDepth },
      events: [],
      seq: 0,
    },
    followup: () => {},
    whenIdle: async () => {},
    cancel: () => {},
  }
  const context = {
    on: () => () => {},
    settings: { describe: () => [] },
    sessions: { get: () => undefined, list: () => [], flush: async () => true },
    workspaceRegistry: {
      list: () => [],
      create: async (path: string) => {
        if (failWorkspaceCreate) throw new Error('simulated workspace create failure')
        return { id: `workspace:${path}`, path, title: path, sessionIds: [], attachSession: async () => {} }
      },
      resolveByPath: async () => undefined,
      delete: async () => true,
    },
    agents: {
      get: (id: string) => id === parent.id ? parent : undefined,
      create: async (options: { sessionId: string; meta?: Record<string, unknown> }) => {
        const agent = childAgent(options.sessionId)
        const record = { id: options.sessionId, meta: options.meta, followups: agent.followups, disposed: 0 }
        createdAgents.push(record)
        return {
          agent,
          dispose: async () => { record.disposed += 1 },
        }
      },
    },
  }
  let releasePrompt: ((message: Awaited<ReturnType<typeof stubUserMessage>>) => void) | undefined
  const promptFactory: NonNullable<WorktreeDelegationRegistryOptions['createUserMessage']> = deferPrompt
    ? (text, source) => new Promise((resolve) => {
        releasePrompt = (message) => resolve(message ?? { id: 'm', role: 'user' as const, content: [{ type: 'text', text }], source })
      })
    : stubUserMessage
  return {
    repo,
    createdAgents,
    context,
    registry: new WorktreeDelegationRegistry(context as never, { createUserMessage: promptFactory }),
    submitPrompt: () => releasePrompt?.(undefined as never),
  }
}

const settle = (ms = 20): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

test('WorkTree delegation only accepts visible session/workspace paths', async () => {
  const repo = await makeRepository()
  const unknown = await mkdtemp(join(tmpdir(), 'dsh-capabilities-unknown-'))
  try {
    const { context } = fakeContext(repo.root)
    const registry = new WorktreeDelegationRegistry(context as never)
    assert.equal(await registry.assertVisible('parent-session', repo.root), await realpath(repo.root))
    await assert.rejects(
      registry.assertVisible('parent-session', unknown),
      /not a visible workspace or linked worktree/,
    )
    registry.dispose()
  } finally {
    await repo.cleanup()
    await rm(unknown, { recursive: true, force: true })
  }
})

test('WorkTree creation adopts the new linked tree as a Workspace', async () => {
  const repo = await makeRepository()
  const previousHome = process.env.DSH_STUDIO_HOME
  const home = await mkdtemp(join(tmpdir(), 'dsh-capabilities-home-'))
  process.env.DSH_STUDIO_HOME = home
  try {
    const workspaceRecords: { path: string; sessionIds: readonly string[] }[] = []
    const { context } = fakeContext(repo.root, workspaceRecords)
    context.workspaceRegistry.create = async (path: string) => {
      const workspace = {
        id: `workspace:${path}`,
        path,
        title: path,
        sessionIds: [],
        attachSession: async () => {},
      }
      workspaceRecords.push(workspace)
      return workspace
    }
    const registry = new WorktreeDelegationRegistry(context as never)
    const result = await registry.createWorktree('parent-session', {
      branch: 'feature/capabilities-test',
      createBranch: true,
    })
    assert.equal(result.branch, 'feature/capabilities-test')
    assert.equal(relative(home, result.path).split(sep)[0], 'worktrees')
    assert.equal(workspaceRecords.length, 1)
    assert.equal(workspaceRecords[0]?.path, result.path)
    registry.dispose()
  } finally {
    if (previousHome === undefined) delete process.env.DSH_STUDIO_HOME
    else process.env.DSH_STUDIO_HOME = previousHome
    await repo.cleanup()
    await rm(home, { recursive: true, force: true })
  }
})

test('delegated children are normal sessions (no subagent origin, cwd + lineage kept)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-delegation-normal-'))
  try {
    const { context, createdAgents, registry } = await delegationHarness({ parentCwd: dir })
    const snapshot = await registry.start('parent-session', dir, 'task')
    assert.equal(createdAgents.length, 1)
    const meta = createdAgents[0]!.meta as Record<string, unknown>
    assert.equal(meta.origin, undefined, 'subagent origin would hide the conversation from the rail and strand it in the catalog')
    assert.equal(meta.cwd, await realpath(dir))
    assert.equal(meta.parentSession, 'parent-session')
    assert.equal(meta.delegationDepth, 1)
    await settle()
    assert.equal(registry.get('parent-session', snapshot.id).state, 'completed')
    registry.dispose()
    void context
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('wait returns the settled state promptly instead of burning the timeout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-delegation-wait-'))
  try {
    const { registry } = await delegationHarness({ parentCwd: dir })
    const snapshot = await registry.start('parent-session', dir, 'quick task')
    const started = Date.now()
    const waited = await registry.wait('parent-session', snapshot.id, 60_000)
    const elapsed = Date.now() - started
    assert.equal(waited.state, 'completed')
    assert.equal(waited.result, 'done')
    assert.ok(elapsed < 5_000, `wait must exit early on settle, took ${elapsed}ms`)
    registry.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('wait honors the timeout when the delegation stays running', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-delegation-timeout-'))
  try {
    const { registry } = await delegationHarness({ parentCwd: dir, stuckAgent: true })
    const snapshot = await registry.start('parent-session', dir, 'long task')
    await settle(30)
    const started = Date.now()
    const waited = await registry.wait('parent-session', snapshot.id, 300)
    const elapsed = Date.now() - started
    assert.ok(elapsed >= 250, `wait must respect the bounded timeout, took ${elapsed}ms`)
    assert.equal(waited.state, 'running')
    registry.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('start() failure after agent creation disposes the handle', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-delegation-leak-'))
  try {
    const { createdAgents, registry } = await delegationHarness({ parentCwd: dir, failWorkspaceCreate: true })
    await assert.rejects(
      registry.start('parent-session', dir, 'task'),
      /simulated workspace create failure/,
    )
    assert.equal(createdAgents.length, 1)
    assert.equal(createdAgents[0]!.disposed, 1, 'the orphaned agent handle must be disposed')
    registry.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('stop() before the prompt submission aborts without running the task', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-delegation-stop-'))
  try {
    const { createdAgents, registry, submitPrompt } = await delegationHarness({ parentCwd: dir, deferPrompt: true })
    const snapshot = await registry.start('parent-session', dir, 'long task')
    registry.stop('parent-session', snapshot.id)
    submitPrompt()
    await settle()
    const record = registry.get('parent-session', snapshot.id)
    assert.equal(record.state, 'aborted')
    assert.equal(createdAgents[0]!.followups.length, 0, 'the task prompt must never reach the delegated agent')
    registry.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('delegation depth cap refuses runaway chains', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-delegation-depth-'))
  try {
    const { registry } = await delegationHarness({ parentCwd: dir, parentDepth: 4 })
    await assert.rejects(
      registry.start('parent-session', dir, 'recurse'),
      /depth limit reached/,
    )
    registry.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

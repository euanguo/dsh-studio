import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { WorktreeDelegationRegistry } from '../plugins/capabilities/src/worktree-orchestration.ts'

const execFile = promisify(execFileCallback)

async function makeRepository(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(`${tmpdir()}/dsh-capabilities-worktree-`)
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

test('WorkTree delegation only accepts visible session/workspace paths', async () => {
  const repo = await makeRepository()
  const unknown = await mkdtemp(`${tmpdir()}/dsh-capabilities-unknown-`)
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
  const home = await mkdtemp(`${tmpdir()}/dsh-capabilities-home-`)
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
    assert.ok(result.path.startsWith(`${home}/worktrees/`))
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

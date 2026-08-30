/**
 * Unit tests for the sidebar runtimes (plugins/sidebar/src/client/runtimes):
 * explorer listing cache semantics and source-control soft-revalidate.
 * Transports are mocked; no network.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  WorkspaceExplorerRuntime,
  type WorkspaceExplorerTransport,
} from '../plugins/sidebar/src/client/runtimes/explorer-runtime.ts'
import {
  SourceControlRuntime,
  type SourceControlRuntimeOptions,
} from '../plugins/sidebar/src/client/runtimes/source-control-runtime.ts'
import {
  SubagentJobsRuntime,
  type JobsRuntimeTransport,
} from '../plugins/sidebar/src/client/subagent/jobs-runtime.ts'

/* ---------- WorkspaceExplorerRuntime ---------- */

function fakeExplorerTransport(): WorkspaceExplorerTransport & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    listDirectory: async relativePath => {
      calls.push(relativePath)
      return [
        { name: 'a.txt', path: `/ws/${relativePath === '' ? '' : `${relativePath}/`}a.txt`, isDirectory: false },
        { name: 'sub', path: `/ws/${relativePath === '' ? 'sub' : `${relativePath}/sub`}`, isDirectory: true },
      ]
    },
  }
}

test('explorer runtime: ensureListing caches Ready listings (zero repeat calls)', async () => {
  const transport = fakeExplorerTransport()
  const runtime = new WorkspaceExplorerRuntime(transport)
  runtime.setWorkspaceRoot('/ws')
  await runtime.ensureListing(null)
  await runtime.ensureListing(null)
  await runtime.ensureListing('sub')
  await runtime.ensureListing('sub')
  assert.deepEqual(transport.calls, ['', 'sub'], 'second ensure hits the cache')
  assert.equal(runtime.getListing(null)?.phase, 'ready')
  assert.equal(runtime.getListing('sub')?.phase, 'ready')
})

test('explorer runtime: in-flight dedup shares one request', async () => {
  const transport = fakeExplorerTransport()
  const runtime = new WorkspaceExplorerRuntime(transport)
  runtime.setWorkspaceRoot('/ws')
  await Promise.all([runtime.ensureListing(null), runtime.ensureListing(null)])
  assert.deepEqual(transport.calls, [''])
})

test('explorer runtime: root change clears listings and bumps generation', async () => {
  const transport = fakeExplorerTransport()
  const runtime = new WorkspaceExplorerRuntime(transport)
  runtime.setWorkspaceRoot('/ws')
  await runtime.ensureListing(null)
  runtime.setWorkspaceRoot('/ws2')
  await runtime.ensureListing(null)
  assert.deepEqual(transport.calls, ['', ''])
  assert.equal(runtime.getListing(null)?.phase, 'ready')
})

test('explorer runtime: error listings are kept and refresh reloads', async () => {
  let fail = true
  const transport: WorkspaceExplorerTransport = {
    listDirectory: async () => {
      if (fail) throw new Error('boom')
      return [{ name: 'ok.txt', path: '/ws/ok.txt', isDirectory: false }]
    },
  }
  const runtime = new WorkspaceExplorerRuntime(transport)
  runtime.setWorkspaceRoot('/ws')
  await runtime.ensureListing(null)
  assert.equal(runtime.getListing(null)?.phase, 'error')
  fail = false
  await runtime.refresh(null)
  assert.equal(runtime.getListing(null)?.phase, 'ready')
})

test('explorer runtime: listings LRU keeps the root', async () => {
  const transport = fakeExplorerTransport()
  const runtime = new WorkspaceExplorerRuntime(transport, 2)
  runtime.setWorkspaceRoot('/ws')
  await runtime.ensureListing(null)
  await runtime.ensureListing('a')
  await runtime.ensureListing('b')
  await runtime.ensureListing('c')
  // Root is protected from eviction; only 2 of the 3 subdirs fit.
  assert.ok(runtime.getListing(null) !== undefined)
  const size = runtime.getListingsSnapshot().size
  assert.ok(size <= 2, `listings capped at maxListings (actual ${size})`)
})

/* ---------- SourceControlRuntime ---------- */

function fakeSourceControlRuntime(): SourceControlRuntimeOptions['transport'] & {
  statusCalls: number
} {
  const calls = { statusCalls: 0 }
  return {
    statusCalls: 0,
    gitStatus: async () => {
      calls.statusCalls += 1
      return { isRepo: true, branch: 'main', entries: [], stats: [] }
    },
    gitBranch: async () => ({ current: 'main', names: ['main'] }),
    gitLog: async () => [],
    gitCommittedFiles: async () => ({ baseRef: 'origin/main', entries: [] }),
    gitCommitFiles: async () => [],
    workspaceFacts: async cwd => ({
      kind: 'repository',
      cwd,
      root: cwd,
      name: cwd.split('/').filter(Boolean).pop() ?? cwd,
      ahead: 0,
      behind: 0,
      hasRemote: false,
    }),
  }
}

test('subagent jobs runtime: equal scopes do not reset its snapshot', () => {
  const transport: JobsRuntimeTransport = {
    jobOutput: async () => ({ text: '' }),
    jobKill: async () => undefined,
  }
  const runtime = new SubagentJobsRuntime(transport)
  let notifications = 0
  const stop = runtime.subscribe(() => { notifications += 1 })
  runtime.setScope({ cwd: '/ws' }, 'session-1')
  const afterFirst = runtime.getSnapshot()
  const firstNotifications = notifications
  runtime.setScope({ cwd: '/ws' }, 'session-1')
  assert.strictEqual(runtime.getSnapshot(), afterFirst)
  assert.equal(notifications, firstNotifications)
  stop()
  runtime.dispose()
})

test('source-control runtime: ready snapshot short-circuits ensureLoaded', async () => {
  const transport = fakeSourceControlRuntime()
  const runtime = new SourceControlRuntime({ transport })
  runtime.setScope({ cwd: '/ws' })
  await runtime.ensureLoaded()
  assert.equal(runtime.getSnapshot().phase, 'ready')
  const callsAfterFirst = transport.statusCalls
  await runtime.ensureLoaded()
  assert.equal(transport.statusCalls, callsAfterFirst, 'second ensure hits the cached snapshot')
})

test('source-control runtime: refresh keeps ready rows visible (soft revalidate)', async () => {
  const transport = fakeSourceControlRuntime()
  const runtime = new SourceControlRuntime({ transport })
  runtime.setScope({ cwd: '/ws' })
  await runtime.ensureLoaded()
  const promise = runtime.refresh()
  // During a soft refresh the phase must stay 'ready' (no loading flash).
  assert.equal(runtime.getSnapshot().phase, 'ready')
  await promise
  assert.equal(runtime.getSnapshot().phase, 'ready')
})

test('source-control runtime: scope switch drops stale data', async () => {
  const transport = fakeSourceControlRuntime()
  const runtime = new SourceControlRuntime({ transport })
  runtime.setScope({ cwd: '/ws' })
  await runtime.ensureLoaded()
  assert.equal(runtime.getSnapshot().phase, 'ready')
  runtime.setScope({ cwd: '/ws2' })
  assert.equal(runtime.getSnapshot().phase, 'loading')
  await runtime.ensureLoaded()
  assert.equal(runtime.getSnapshot().phase, 'ready')
  assert.equal(runtime.getSnapshot().snapshot?.root, '/ws2')
})

test('source-control runtime: reportError surfaces mutation failures', async () => {
  const transport = fakeSourceControlRuntime()
  const runtime = new SourceControlRuntime({ transport })
  runtime.setScope({ cwd: '/ws' })
  await runtime.ensureLoaded()
  runtime.reportError('stage failed')
  const snapshot = runtime.getSnapshot()
  assert.equal(snapshot.phase, 'error')
  assert.equal(snapshot.message, 'stage failed')
  assert.ok(snapshot.snapshot !== null, 'keeps the last ready snapshot for display')
})

/* ---------- commit history retention (D20b/D21 regression) ---------- */

const LOG_ENTRY = {
  hash: 'abc1234',
  hashFull: 'abc1234567890abcdef',
  subject: 'init',
  author: 'tester',
  date: '2026-08-25',
  refs: '',
}

function historyTransport(): SourceControlRuntimeOptions['transport'] & {
  readonly logCalls: number
  setFailNextLog(value: boolean): void
} {
  const base = fakeSourceControlRuntime()
  let logCalls = 0
  let failLog = false
  return {
    gitStatus: path => base.gitStatus(path),
    gitBranch: scope => base.gitBranch(scope),
    gitCommittedFiles: scope => base.gitCommittedFiles(scope),
    gitCommitFiles: (scope, hash) => base.gitCommitFiles(scope, hash),
    workspaceFacts: cwd => base.workspaceFacts(cwd),
    gitLog: async () => {
      logCalls += 1
      if (failLog) throw new Error('boom')
      return [LOG_ENTRY]
    },
    get logCalls() { return logCalls },
    setFailNextLog(value: boolean) { failLog = value },
  }
}

test('source-control runtime: unchanged polls keep commit history', async () => {
  // The D20b skip path used to pass a fresh `history: []` into the
  // snapshot, so every unchanged soft-refresh wiped the visible rows.
  const transport = historyTransport()
  const runtime = new SourceControlRuntime({ transport })
  runtime.setScope({ cwd: '/ws' })
  await runtime.ensureLoaded()
  assert.equal(runtime.getSnapshot().snapshot?.history.length, 1)
  await runtime.refresh()
  await runtime.refresh()
  assert.equal(transport.logCalls, 1, 'unchanged status must not refetch the log')
  assert.equal(runtime.getSnapshot().snapshot?.history.length, 1, 'unchanged poll keeps previous rows')
})

test('source-control runtime: git.log failure keeps previous history', async () => {
  const transport = historyTransport()
  const runtime = new SourceControlRuntime({ transport })
  runtime.setScope({ cwd: '/ws' })
  await runtime.ensureLoaded()

  // A real change forces the heavyweight branch+log refetch; make it fail.
  transport.setFailNextLog(true)
  transport.gitStatus = async () => ({
    isRepo: true,
    branch: 'main',
    entries: [{ xy: 'M ', path: 'a.txt' }],
    stats: [],
  })
  await runtime.refresh()
  assert.equal(transport.logCalls, 2, 'changed status does refetch the log')
  assert.equal(runtime.getSnapshot().snapshot?.history.length, 1, 'failed fetch falls back to previous rows')

  // Recovered: the next changed poll shows fresh data again.
  transport.setFailNextLog(false)
  transport.gitStatus = async () => ({
    isRepo: true,
    branch: 'main',
    entries: [
      { xy: 'M ', path: 'a.txt' },
      { xy: 'A ', path: 'b.txt' },
    ],
    stats: [],
  })
  await runtime.refresh()
  assert.equal(transport.logCalls, 3)
  assert.equal(runtime.getSnapshot().snapshot?.history.length, 1)
})

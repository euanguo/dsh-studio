import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SourceControlRuntime,
  type SourceControlScope,
  type SourceControlTransport,
} from '../plugins/sidebar/src/client/runtimes/source-control-runtime.ts'
import {
  WorkspaceExplorerRuntime,
  type WorkspaceExplorerTransport,
} from '../plugins/sidebar/src/client/runtimes/explorer-runtime.ts'

test('SourceControlRuntime aborts in-flight requests on rapid scope switches', async () => {
  let abortCount = 0
  const transport: SourceControlTransport = {
    workspaceFacts: (_cwd, signal) => new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => {
        abortCount += 1
        reject(new DOMException('Aborted', 'AbortError'))
      })
      setTimeout(() => {
        resolve({
          kind: 'repository',
          branch: 'main',
          branches: ['main'],
          changes: [],
        } as any)
      }, 100)
    }),
    gitStatus: () => Promise.resolve({ isRepo: true, entries: [], stats: [] }),
    gitBranch: () => Promise.resolve({ current: 'main', names: ['main'] }),
    gitLog: () => Promise.resolve([]),
  }

  const runtime = new SourceControlRuntime({ transport })
  runtime.setScope({ sessionId: 's1', cwd: '/repo-1' })
  // Rapidly switch scope before first load finishes
  runtime.setScope({ sessionId: 's2', cwd: '/repo-2' })

  assert.ok(abortCount >= 1)
  runtime.dispose()
})

test('WorkspaceExplorerRuntime dedupes concurrent directory listing requests and respects LRU', async () => {
  let listCalls = 0
  const transport: WorkspaceExplorerTransport = {
    listDirectory: relativePath => {
      listCalls += 1
      return Promise.resolve([
        { name: `file-in-${relativePath || 'root'}.txt`, path: `/root/${relativePath || ''}`, isDirectory: false },
      ])
    },
  }

  const runtime = new WorkspaceExplorerRuntime(transport, 3)
  runtime.setWorkspaceRoot('/workspace')

  // Concurrent ensureListing calls on same key
  await Promise.all([
    runtime.ensureListing('sub-dir-1'),
    runtime.ensureListing('sub-dir-1'),
    runtime.ensureListing('sub-dir-1'),
  ])

  // Inflight dedup should result in only 2 transport calls (1 root on setWorkspaceRoot + 1 for sub-dir-1)
  assert.equal(listCalls, 2)

  // Expand more directories to trigger LRU eviction
  await runtime.ensureListing('sub-dir-2')
  await runtime.ensureListing('sub-dir-3')
  await runtime.ensureListing('sub-dir-4')

  const snapshot = runtime.getListingsSnapshot()
  assert.ok(snapshot.size <= 3)
  // Root directory should be protected from eviction
  assert.ok(snapshot.has(''))

  runtime.dispose()
})

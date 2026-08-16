/**
 * Unit tests for the diff/commit review runtime
 * (plugins/sidebar/src/client/runtimes/diff-runtime.ts): retained caching
 * semantics, in-flight dedup, scope reset generation gating and the
 * expand-context file swap. Transports are mocked; no network.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  WorkspaceDiffRuntime,
  type WorkspaceDiffTransport,
  commitListKey,
  committedListKey,
  worktreeDocKey,
  worktreeListKey,
} from '../plugins/sidebar/src/client/runtimes/diff-runtime.ts'
import type { GitReviewFile } from '../plugins/sidebar/src/client/diff/git-review-diff.ts'

function sampleFile(path: string): GitReviewFile {
  return {
    path,
    oldPath: null,
    status: 'added',
    additions: 2,
    deletions: 0,
    lines: [
      { key: `${path}:1`, type: 'addition', content: 'a', oldLine: null, newLine: 1 },
      { key: `${path}:2`, type: 'addition', content: 'b', oldLine: null, newLine: 2 },
    ],
  }
}

function fakeDiffTransport(): WorkspaceDiffTransport & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    loadWorktreeList: async staged => {
      calls.push(`list:w:${staged ? 'staged' : 'unstaged'}`)
      return [sampleFile('a.ts'), sampleFile('b.ts')]
    },
    loadWorktreeDoc: async (_staged, filePath, context) => {
      calls.push(`doc:w:${filePath}:${context}`)
      return `diff --git a/${filePath} b/${filePath}\n`
    },
    loadCommitList: async hash => {
      calls.push(`list:c:${hash}`)
      return [sampleFile('c.ts')]
    },
    loadCommitDoc: async (hash, filePath) => {
      calls.push(`doc:c:${hash}:${filePath}`)
      return `commit diff ${filePath}\n`
    },
    loadCommittedList: async baseRef => {
      calls.push(`list:m:${baseRef}`)
      return [sampleFile('d.ts')]
    },
    loadCommittedDoc: async (baseRef, filePath) => {
      calls.push(`doc:m:${baseRef}:${filePath}`)
      return `committed diff ${filePath}\n`
    },
  }
}

test('diff runtime: ready entries short-circuit (zero repeat calls)', async () => {
  const transport = fakeDiffTransport()
  const runtime = new WorkspaceDiffRuntime(transport)
  runtime.setScope('s1:/ws')
  await runtime.ensureWorktreeList(false)
  await runtime.ensureWorktreeList(false)
  await runtime.ensureWorktreeDoc(false, 'a.ts', 3)
  await runtime.ensureWorktreeDoc(false, 'a.ts', 3)
  assert.deepEqual(transport.calls, ['list:w:unstaged', 'doc:w:a.ts:3'])
  assert.equal(runtime.getList(worktreeListKey(false))?.files?.length, 2)
  assert.equal(runtime.getDoc(worktreeDocKey(false, 'a.ts', 3))?.phase, 'ready')
})

test('diff runtime: in-flight dedup shares one request', async () => {
  const transport = fakeDiffTransport()
  const runtime = new WorkspaceDiffRuntime(transport)
  runtime.setScope('s1:/ws')
  await Promise.all([runtime.ensureCommitList('abc'), runtime.ensureCommitList('abc')])
  assert.deepEqual(transport.calls, ['list:c:abc'])
})

test('diff runtime: context is part of the doc key', async () => {
  const transport = fakeDiffTransport()
  const runtime = new WorkspaceDiffRuntime(transport)
  runtime.setScope('s1:/ws')
  await runtime.ensureWorktreeDoc(false, 'a.ts', 3)
  await runtime.ensureWorktreeDoc(false, 'a.ts', 23)
  assert.deepEqual(transport.calls, ['doc:w:a.ts:3', 'doc:w:a.ts:23'])
})

test('diff runtime: scope reset clears entries and gates stale loads', async () => {
  const transport = fakeDiffTransport()
  const runtime = new WorkspaceDiffRuntime(transport)
  runtime.setScope('s1:/ws')
  await runtime.ensureWorktreeList(false)
  assert.equal(runtime.getList(worktreeListKey(false))?.phase, 'ready')
  runtime.setScope('s2:/ws')
  assert.equal(runtime.getList(worktreeListKey(false)), undefined, 'entries cleared on scope change')
  await runtime.ensureWorktreeList(false)
  assert.equal(runtime.getScope(), 's2:/ws')
})

test('diff runtime: load failures become error entries (not rejections)', async () => {
  const transport: WorkspaceDiffTransport = {
    loadWorktreeList: async () => {
      throw new Error('boom')
    },
    loadWorktreeDoc: async () => 'x',
    loadCommitList: async () => [],
    loadCommitDoc: async () => 'x',
    loadCommittedList: async () => [],
    loadCommittedDoc: async () => 'x',
  }
  const runtime = new WorkspaceDiffRuntime(transport)
  runtime.setScope('s1:/ws')
  const entry = await runtime.ensureWorktreeList(false)
  assert.equal(entry.phase, 'error')
  assert.equal(entry.message, 'boom')
  // Error entries short-circuit like ready ones.
  await runtime.ensureWorktreeList(false)
})

test('diff runtime: expandWorktreeFile swaps the wider doc into the list', async () => {
  const transport = fakeDiffTransport()
  const runtime = new WorkspaceDiffRuntime(transport)
  runtime.setScope('s1:/ws')
  await runtime.ensureWorktreeList(false)
  const doc = await runtime.expandWorktreeFile(false, 'a.ts', 20)
  assert.equal(doc.phase, 'ready')
  const list = runtime.getList(worktreeListKey(false))
  assert.equal(list?.files?.length, 2, 'list keeps both files')
  assert.deepEqual(transport.calls, ['list:w:unstaged', 'doc:w:a.ts:20'])
  assert.equal(runtime.getDoc(worktreeDocKey(false, 'a.ts', 20))?.phase, 'ready', 'expanded doc cached')
})

test('diff runtime: committed/commit keys do not collide', async () => {
  const transport = fakeDiffTransport()
  const runtime = new WorkspaceDiffRuntime(transport)
  runtime.setScope('s1:/ws')
  await runtime.ensureCommitList('abc')
  await runtime.ensureCommittedList('abc')
  assert.deepEqual(transport.calls, ['list:c:abc', 'list:m:abc'])
  assert.equal(runtime.getList(commitListKey('abc'))?.files?.length, 1)
  assert.equal(runtime.getList(committedListKey('abc'))?.files?.length, 1)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  migrateCommentsFromLegacy,
} from '../plugins/shared/comments-migration.ts'

test('workbench v1 line comments map onto the persisted workbench shape', () => {
  const out = migrateCommentsFromLegacy(
    undefined,
    [
      { id: 'a', filePath: 'src/a.ts', line: 12, body: 'watch the null check', createdAt: 't1' },
      { id: 'b', filePath: 'src/b.ts', line: 3, body: 'rename', createdAt: 't2' },
    ],
    undefined,
  )
  assert.equal(out.workbench.length, 2)
  assert.deepEqual(
    { path: out.workbench[0]!.path, startLine: out.workbench[0]!.startLine, endLine: out.workbench[0]!.endLine },
    { path: 'src/a.ts', startLine: 12, endLine: undefined },
  )
  assert.deepEqual(out.review, [])
})

test('workbench v2 (already folded) wins over the v1 fallback', () => {
  const out = migrateCommentsFromLegacy(
    [{ id: 'v2', path: 'p.ts', startLine: 5, body: 'b', createdAt: 't', contentHash: 'h' }],
    [{ id: 'v1', filePath: 'p.ts', line: 5, body: 'b', createdAt: 't' }],
    undefined,
  )
  assert.equal(out.workbench.length, 1)
  assert.equal(out.workbench[0]!.id, 'v2')
  assert.equal(out.workbench[0]!.contentHash, 'h')
})

test('review comments keep their lifecycle fields through migration', () => {
  const out = migrateCommentsFromLegacy(
    undefined,
    undefined,
    [{
      id: 'r1',
      workspacePath: '/ws',
      branch: 'feature/x',
      commitId: 'abc123',
      filePath: 'src/x.ts',
      line: 7,
      side: 'new',
      body: 'consider a guard',
      createdAt: 't',
      resolvedAt: 't2',
      request: '[[[...]]]',
    }],
  )
  assert.equal(out.review.length, 1)
  assert.equal(out.review[0]!.branch, 'feature/x')
  assert.equal(out.review[0]!.line, 7)
  assert.equal(out.review[0]!.resolvedAt, 't2')
})

test('malformed legacy entries are dropped, not fatal', () => {
  const out = migrateCommentsFromLegacy(
    undefined,
    [
      { id: 'ok', filePath: 'x.ts', line: 1, body: 'b', createdAt: 't' },
      { id: 'bad', filePath: 'x.ts', line: 'nope', body: 'b', createdAt: 't' },
    ],
    [{ id: 'incomplete', workspacePath: '/ws' }],
  )
  assert.equal(out.workbench.length, 1)
  assert.equal(out.workbench[0]!.id, 'ok')
  assert.equal(out.review.length, 0)
})
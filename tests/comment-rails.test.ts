import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildCommentReference,
  commentCoversLine,
} from '../plugins/sidebar/src/client/comments/comment-rails-core.ts'
import type { WorkbenchComment } from '../plugins/sidebar/src/client/diff/diff-comments-store.ts'

const SAMPLE: WorkbenchComment = {
  id: 'c1',
  path: '/repo/src/a.ts',
  startLine: 8,
  endLine: 12,
  body: 'extract this block',
  createdAt: 't',
}

test('commentCoversLine matches single- and multi-line anchors in cwd terms', () => {
  const cwd = '/repo'
  assert.equal(commentCoversLine(SAMPLE, '/repo/src/a.ts', cwd, 8), true)
  assert.equal(commentCoversLine(SAMPLE, '/repo/src/a.ts', cwd, 12), true)
  assert.equal(commentCoversLine(SAMPLE, '/repo/src/a.ts', cwd, 7), false)
  assert.equal(commentCoversLine(SAMPLE, '/repo/src/a.ts', cwd, 13), false)
  // Paths compare after cwd normalization (git-relative vs absolute).
  assert.equal(commentCoversLine(SAMPLE, 'src/a.ts', cwd, 9), true)
  // A different file never matches.
  assert.equal(commentCoversLine(SAMPLE, '/repo/src/b.ts', cwd, 9), false)
})

test('single-line comments cover only their own line', () => {
  const single: WorkbenchComment = { id: 'c2', path: '/repo/x.ts', startLine: 3, body: 'b', createdAt: 't' }
  assert.equal(commentCoversLine(single, '/repo/x.ts', '/repo', 3), true)
  assert.equal(commentCoversLine(single, '/repo/x.ts', '/repo', 4), false)
})

test('buildCommentReference renders path:line with and without body', () => {
  assert.equal(buildCommentReference('/repo/src/a.ts', 8, 'watch out'), '`/repo/src/a.ts` L8: watch out')
  assert.equal(buildCommentReference('src/a.ts', 3, '  '), '`src/a.ts` L3')
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseGitReviewDiff,
  reviewCommitFromWire,
} from '../plugins/sidebar/src/client/diff/git-review-diff.ts'
import {
  formatReviewComment,
  formatReviewRequest,
} from '../plugins/sidebar/src/client/review/review-comments.ts'

test('Better Sidebar commit patches become line-addressable reviews', () => {
  const diff = [
    'diff --git a/src/value.ts b/src/value.ts',
    '--- a/src/value.ts',
    '+++ b/src/value.ts',
    '@@ -1,2 +1,2 @@',
    '-export const value = 1',
    '+export const value = 2',
    ' export const stable = true',
  ].join('\n')
  const files = parseGitReviewDiff(diff)
  assert.equal(files.length, 1)
  assert.equal(files[0]?.additions, 1)
  assert.equal(files[0]?.deletions, 1)
  assert.deepEqual(files[0]?.lines.map(line => [
    line.type,
    line.oldLine,
    line.newLine,
  ]), [
    ['deletion', 1, null],
    ['addition', null, 1],
    ['context', 2, 2],
  ])
  const commit = reviewCommitFromWire({
    hash: 'abc1234',
    hashFull: 'abc1234567890',
    subject: 'fix value',
    author: 'Oh DSH Test',
    date: '2026-08-12 10:00:00 +0800',
    refs: 'HEAD -> main',
  }, diff)
  assert.equal(commit.shortId, 'abc1234')
  assert.equal(commit.files[0]?.path, 'src/value.ts')

  const comment = formatReviewComment(commit, {
    id: 'review-1',
    sessionId: 'session-1',
    workspacePath: '/workspace',
    branch: 'main',
    commitId: commit.id,
    filePath: 'src/value.ts',
    line: 1,
    side: 'new',
    body: 'Keep this value configurable.',
    createdAt: '2026-08-12T02:00:00.000Z',
    request: '',
  })
  assert.match(comment, /src\/value\.ts:R1/)
  assert.match(comment, /Code: export const value = 2/)
  assert.match(formatReviewRequest([comment]), /actionable code-change request/)
})

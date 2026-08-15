/**
 * Unit tests for the comment → Pierre annotation mapping
 * (plugins/sidebar/src/client/diff/comment-annotations.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  COMMENT_ANNOTATION_SIDE,
  commentsToDiffLineAnnotations,
  commentsToFileLineAnnotations,
} from '../plugins/sidebar/src/client/diff/comment-annotations.ts'
import {
  commentPathMatches,
  pathRelativeToCwd,
} from '../plugins/sidebar/src/client/diff/diff-comments-store.ts'
import type { DiffComment } from '../plugins/sidebar/src/client/diff/diff-comments-store.ts'

const SAMPLE: DiffComment[] = [
  {
    id: 'c1',
    filePath: 'src/a.ts',
    line: 12,
    body: 'watch the null check',
    createdAt: '2026-08-16T00:00:00.000Z',
  },
  {
    id: 'c2',
    filePath: 'src/a.ts',
    line: 40,
    body: 'rename this',
    createdAt: '2026-08-16T00:01:00.000Z',
  },
]

test('commentsToDiffLineAnnotations hangs on the additions side at the comment line', () => {
  const annotations = commentsToDiffLineAnnotations(SAMPLE)
  assert.equal(annotations.length, 2)
  assert.deepEqual(
    { side: annotations[0]!.side, lineNumber: annotations[0]!.lineNumber },
    { side: COMMENT_ANNOTATION_SIDE, lineNumber: 12 },
  )
  assert.equal(annotations[0]!.metadata, SAMPLE[0])
  assert.equal(annotations[1]!.metadata, SAMPLE[1])
})

test('commentsToFileLineAnnotations maps the same line numbers without a side', () => {
  const annotations = commentsToFileLineAnnotations(SAMPLE)
  assert.equal(annotations.length, 2)
  assert.deepEqual(
    annotations.map(annotation => annotation.lineNumber),
    [12, 40],
  )
  assert.equal(annotations[1]!.metadata?.body, 'rename this')
})

test('empty comment lists map to empty annotation lists', () => {
  assert.deepEqual(commentsToDiffLineAnnotations([]), [])
  assert.deepEqual(commentsToFileLineAnnotations([]), [])
})

test('annotations preserve identity of the underlying comment', () => {
  const [annotation] = commentsToDiffLineAnnotations(SAMPLE)
  assert.equal(annotation?.metadata?.id, 'c1')
  assert.equal(annotation?.metadata?.createdAt, '2026-08-16T00:00:00.000Z')
})

const CWD = '/home/dev/repo'

test('pathRelativeToCwd strips the workspace prefix only', () => {
  assert.equal(pathRelativeToCwd('/home/dev/repo/src/a.ts', CWD), 'src/a.ts')
  assert.equal(pathRelativeToCwd('src/a.ts', CWD), 'src/a.ts')
  assert.equal(pathRelativeToCwd('/other/place/a.ts', CWD), '/other/place/a.ts')
  // Trailing-slash cwd is handled too.
  assert.equal(pathRelativeToCwd('/home/dev/repo/src/a.ts', `${CWD}/`), 'src/a.ts')
})

test('commentPathMatches equates git-relative and absolute surface paths', () => {
  assert.equal(commentPathMatches('src/a.ts', '/home/dev/repo/src/a.ts', CWD), true)
  assert.equal(commentPathMatches('src/a.ts', 'src/a.ts', CWD), true)
  assert.equal(commentPathMatches('src/a.ts', '/home/dev/repo/src/b.ts', CWD), false)
  // A path under a sibling directory must not match a same-named prefix.
  assert.equal(commentPathMatches('src/a.ts', '/home/dev/repo/src2/a.ts', CWD), false)
})

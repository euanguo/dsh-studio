/**
 * Unit tests for the unified diff document entity
 * (plugins/desktop-sidebar/src/client/diff/file-diff.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildDiffDocument,
  buildPatch,
  summarizeDiffDocuments,
} from '../plugins/desktop-sidebar/src/client/diff/file-diff.ts'

const SAMPLE_PATCH = [
  'diff --git a/a.ts b/a.ts',
  'index 111..222 100644',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1,3 +1,4 @@',
  ' line1',
  '-line2',
  '+line2 changed',
  ' line3',
  '+line4 new',
].join('\n')

test('buildDiffDocument parses lines, hunks and stats', () => {
  const doc = buildDiffDocument({
    path: 'a.ts',
    change: 'modified',
    additions: 0,
    deletions: 0,
    patch: SAMPLE_PATCH,
  })
  assert.equal(doc.path, 'a.ts')
  assert.equal(doc.additions, 2)
  assert.equal(doc.deletions, 1)
  assert.deepEqual(
    doc.lines.map(line => line.kind),
    ['hunk', 'context', 'removed', 'added', 'context', 'added'],
  )
  const removed = doc.lines[2]!
  assert.equal(removed.oldLine, 2)
  assert.equal(removed.newLine, null)
  const added = doc.lines[3]!
  assert.equal(added.oldLine, null)
  assert.equal(added.newLine, 2)
})

test('buildDiffDocument: patch stats override provided stats', () => {
  const doc = buildDiffDocument({
    path: 'a.ts',
    change: 'modified',
    additions: 999,
    deletions: 999,
    patch: SAMPLE_PATCH,
  })
  assert.equal(doc.additions, 2)
  assert.equal(doc.deletions, 1)
})

test('buildDiffDocument: empty patch keeps provided stats and no lines', () => {
  const doc = buildDiffDocument({
    path: 'a.ts',
    change: 'added',
    additions: 4,
    deletions: 0,
    patch: '',
  })
  assert.equal(doc.additions, 4)
  assert.deepEqual(doc.lines, [])
})

test('buildPatch round-trips a document back to a diff text', () => {
  const doc = buildDiffDocument({
    path: 'a.ts',
    change: 'modified',
    additions: 0,
    deletions: 0,
    patch: SAMPLE_PATCH,
  })
  const patch = buildPatch(doc)
  assert.ok(patch.startsWith('diff --git a/a.ts b/a.ts'))
  assert.ok(patch.includes('--- a/a.ts'))
  assert.ok(patch.includes('+++ b/a.ts'))
  assert.ok(patch.includes('+line2 changed'))
  assert.ok(patch.includes('-line2'))
})

test('summarizeDiffDocuments aggregates file counts and stats', () => {
  const one = buildDiffDocument({ path: 'a.ts', change: 'modified', additions: 0, deletions: 0, patch: SAMPLE_PATCH })
  const two = buildDiffDocument({ path: 'b.ts', change: 'added', additions: 0, deletions: 0, patch: '' })
  const summary = summarizeDiffDocuments([one, two])
  assert.equal(summary.fileCount, 2)
  assert.equal(summary.additions, 2)
  assert.equal(summary.deletions, 1)
})

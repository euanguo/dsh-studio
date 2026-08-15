/**
 * Unit tests for the unified diff document entity
 * (plugins/sidebar/src/client/diff/file-diff.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildDiffDocument,
  buildPatch,
  summarizeDiffDocuments,
} from '../plugins/sidebar/src/client/diff/file-diff.ts'

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

test('buildPatch regenerates hunk headers for review-style documents', () => {
  const line = (kind: 'context' | 'added' | 'removed', text: string, oldLine: number | null, newLine: number | null) => ({
    kind,
    text,
    displayText: text === '' ? ' ' : text,
    oldLine,
    newLine,
    oldLineLabel: oldLine === null ? ' ' : String(oldLine),
    newLineLabel: newLine === null ? ' ' : String(newLine),
  })
  // Review documents carry no `hunk` rows — the patch must still emit @@ headers.
  const doc = {
    path: 'a.ts',
    change: 'modified' as const,
    additions: 2,
    deletions: 1,
    lines: [
      line('context', 'import x', 1, 1),
      line('removed', 'old line', 2, null),
      line('added', 'new line', null, 2),
      line('context', 'context', 3, 3),
      line('added', 'added', null, 4),
      line('context', 'tail', 4, 5),
    ],
  }
  const patch = buildPatch(doc)
  assert.ok(patch.includes('@@ -1,4 +1,5 @@'), `hunk header missing: ${JSON.stringify(patch)}`)
  // Round-trips through our own parser with line numbers intact.
  const reparsed = buildDiffDocument({ path: 'a.ts', change: 'modified', additions: 0, deletions: 0, patch })
  assert.equal(reparsed.lines.filter(l => l.kind === 'hunk').length, 1)
  assert.equal(reparsed.lines.filter(l => l.kind === 'added').length, 2)
  assert.equal(reparsed.lines.filter(l => l.kind === 'removed').length, 1)
})

test('buildPatch splits disconnected line ranges into separate hunks', () => {
  const line = (kind: 'context' | 'added', text: string, oldLine: number | null, newLine: number | null) => ({
    kind,
    text,
    displayText: text === '' ? ' ' : text,
    oldLine,
    newLine,
    oldLineLabel: oldLine === null ? ' ' : String(oldLine),
    newLineLabel: newLine === null ? ' ' : String(newLine),
  })
  const doc = {
    path: 'a.ts',
    change: 'modified' as const,
    additions: 2,
    deletions: 0,
    lines: [
      line('context', 'c1', 1, 1),
      line('added', 'a1', null, 2),
      // gap on both sides → new hunk
      line('context', 'c2', 50, 51),
      line('added', 'a2', null, 52),
    ],
  }
  const patch = buildPatch(doc)
  assert.ok(patch.includes('@@ -1,1 +1,2 @@'), `first hunk: ${JSON.stringify(patch)}`)
  assert.ok(patch.includes('@@ -50,1 +51,2 @@'), `second hunk: ${JSON.stringify(patch)}`)
})

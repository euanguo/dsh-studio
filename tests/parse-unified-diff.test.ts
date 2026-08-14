import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isNoTextDiff,
  parseUnifiedDiff,
} from '../plugins/desktop-sidebar/src/client/parse-unified-diff.ts'

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 const one = 1
-old line
+new line
+added line
 context
@@ -10,2 +11,2 @@
-removed
 kept
`

test('parseUnifiedDiff extracts paths, hunks and classified lines', () => {
  const diff = parseUnifiedDiff(SAMPLE)
  assert.ok(diff !== null)
  assert.equal(diff.oldPath, 'src/a.ts')
  assert.equal(diff.newPath, 'src/a.ts')
  assert.equal(diff.hunks.length, 2)

  const [hunk1Raw, hunk2Raw] = diff.hunks
  assert.ok(hunk1Raw !== undefined && hunk2Raw !== undefined)
  const hunk1 = hunk1Raw
  const hunk2 = hunk2Raw
  assert.equal(hunk1.header, '@@ -1,3 +1,4 @@')
  assert.deepEqual(hunk1.lines, [
    { type: 'context', oldLine: 1, newLine: 1, content: 'const one = 1' },
    { type: 'deletion', oldLine: 2, newLine: null, content: 'old line' },
    { type: 'addition', oldLine: null, newLine: 2, content: 'new line' },
    { type: 'addition', oldLine: null, newLine: 3, content: 'added line' },
    { type: 'context', oldLine: 3, newLine: 4, content: 'context' },
  ])
  assert.equal(hunk2.header, '@@ -10,2 +11,2 @@')
  assert.deepEqual(hunk2.lines, [
    { type: 'deletion', oldLine: 10, newLine: null, content: 'removed' },
    { type: 'context', oldLine: 11, newLine: 11, content: 'kept' },
  ])
})

test('parseUnifiedDiff tolerates tabs in content and no-newline markers', () => {
  const diff = parseUnifiedDiff([
    'diff --git a/t b/t',
    '--- a/t',
    '+++ b/t',
    '@@ -1 +1 @@',
    '-a\tb',
    '+c\td',
    '\\ No newline at end of file',
  ].join('\n'))
  assert.ok(diff !== null)
  assert.deepEqual(diff.hunks[0]!.lines.map(line => line.content), ['a\tb', 'c\td'])
})

test('parseUnifiedDiff returns null for non-diff text', () => {
  assert.equal(parseUnifiedDiff('plain text'), null)
  assert.equal(parseUnifiedDiff(''), null)
})

test('isNoTextDiff recognizes empty and binary responses', () => {
  assert.equal(isNoTextDiff(''), true)
  assert.equal(isNoTextDiff('   '), true)
  assert.equal(isNoTextDiff('Binary files a/x and b/x differ'), true)
  assert.equal(isNoTextDiff('@@ -1 +1 @@\n-a\n+b'), false)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildSelectionInsert,
  headerOf,
  linesOfSelection,
  SELECTION_LIMIT,
} from '../plugins/sidebar/src/client/files/file-selection-reference.ts'

const CWD = '/work/project'
const PATH = '/work/project/src/util.ts'

test('headerOf writes a relative path, with lines only when known', () => {
  assert.equal(headerOf(PATH, CWD), 'src/util.ts')
  assert.equal(headerOf(PATH, CWD, { start: 12, end: 12 }), 'src/util.ts:12')
  assert.equal(headerOf(PATH, CWD, { start: 12, end: 15 }), 'src/util.ts:12-15')
  // Unknown cwd falls back to the absolute path.
  assert.equal(headerOf(PATH, undefined, { start: 3, end: 3 }), '/work/project/src/util.ts:3')
})

test('buildSelectionInsert fences a bounded selection with an info line', () => {
  const payload = buildSelectionInsert(PATH, CWD, { start: 10, end: 12 }, 'const a = 1\nconst b = 2')
  assert.equal(payload, '```src/util.ts:10-12\nconst a = 1\nconst b = 2\n```')
  // Single line: `path:line`, no dash.
  assert.equal(buildSelectionInsert(PATH, CWD, { start: 10, end: 10 }, 'x'), '```src/util.ts:10\nx\n```')
})

test('buildSelectionInsert degrades to a plain path line over the limit', () => {
  const huge = 'x'.repeat(SELECTION_LIMIT + 1)
  assert.equal(buildSelectionInsert(PATH, CWD, { start: 1, end: 1 }, huge), 'src/util.ts:1')
  // Exactly the limit still fences.
  assert.equal(buildSelectionInsert(PATH, CWD, undefined, 'y'.repeat(SELECTION_LIMIT)).startsWith('```'), true)
})

test('linesOfSelection reverse-maps only an unambiguous match', () => {
  const source = 'line one\nline two\nline three'
  assert.deepEqual(linesOfSelection(source, 'line two'), { start: 2, end: 2 })
  assert.deepEqual(linesOfSelection(source, 'line one\nline two'), { start: 1, end: 2 })
  // A trailing newline (DOM block selections) is stripped first.
  assert.deepEqual(linesOfSelection(source, 'line two\n'), { start: 2, end: 2 })
  // Ambiguous / missing matches yield null (no line numbers in the header).
  assert.equal(linesOfSelection('a\nb\na\n', 'a'), null)
  assert.equal(linesOfSelection(source, 'not present'), null)
  assert.equal(linesOfSelection(source, ''), null)
  // Header omits lines when the reverse-search missed.
  assert.equal(headerOf(PATH, CWD, linesOfSelection(source, 'not present') ?? undefined), 'src/util.ts')
})
/**
 * Unit tests for the P2 multi-file diff path tree builder
 * (plugins/sidebar/src/client/diff/diff-path-tree.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildDiffTreeRows } from '../plugins/sidebar/src/client/diff/diff-path-tree.ts'

test('buildDiffTreeRows creates directory rows and selected file rows', () => {
  const rows = buildDiffTreeRows(
    [{ path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'README.md' }],
    'src/a.ts',
    new Set(),
  )
  assert.deepEqual(
    rows.filter(row => row.kind === 'directory').map(row => row.path),
    ['src'],
  )
  assert.deepEqual(
    rows.filter(row => row.kind === 'file').map(row => row.path),
    ['README.md', 'src/a.ts', 'src/b.ts'],
  )
  const selected = rows.find(row => row.kind === 'file' && row.path === 'src/a.ts')
  assert.equal(selected?.selected, true)
})

test('buildDiffTreeRows hides children of collapsed directories', () => {
  const rows = buildDiffTreeRows(
    [{ path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'README.md' }],
    null,
    new Set(['src']),
  )
  assert.equal(rows.some(row => row.kind === 'file' && row.path === 'src/a.ts'), false)
  assert.equal(rows.some(row => row.kind === 'file' && row.path === 'README.md'), true)
})

test('buildDiffTreeRows handles top-level files with no directories', () => {
  const rows = buildDiffTreeRows([{ path: 'a.ts' }, { path: 'b.ts' }], null, new Set())
  assert.equal(rows.length, 2)
  assert.equal(rows.every(row => row.kind === 'file'), true)
})

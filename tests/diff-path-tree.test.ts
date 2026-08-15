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
  // Depth-first: the src directory's files follow the directory row,
  // root files come after the whole subtree.
  assert.deepEqual(rows.map(row => row.path), ['src', 'src/a.ts', 'src/b.ts', 'README.md'])
  const selected = rows.find(row => row.kind === 'file' && row.path === 'src/a.ts')
  assert.equal(selected?.selected, true)
  assert.equal(selected?.depth, 1)
})

test('buildDiffTreeRows hides children of collapsed directories', () => {
  const rows = buildDiffTreeRows(
    [{ path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'README.md' }],
    null,
    new Set(['src']),
  )
  assert.equal(rows.some(row => row.kind === 'file' && row.path === 'src/a.ts'), false)
  assert.equal(rows.some(row => row.kind === 'file' && row.path === 'README.md'), true)
  const dir = rows.find(row => row.kind === 'directory' && row.path === 'src')
  assert.equal(dir?.collapsed, true)
})

test('buildDiffTreeRows interleaves nested directories with their files', () => {
  const rows = buildDiffTreeRows(
    [
      { path: 'src/util/x.ts' },
      { path: 'src/a.ts' },
      { path: 'pkg/b.ts' },
      { path: 'README.md' },
    ],
    null,
    new Set(),
  )
  // Each directory row is immediately followed by its own subtree;
  // within a level directories come before files.
  assert.deepEqual(rows.map(row => row.path), [
    'pkg',
    'pkg/b.ts',
    'src',
    'src/util',
    'src/util/x.ts',
    'src/a.ts',
    'README.md',
  ])
  const util = rows.find(row => row.kind === 'directory' && row.path === 'src/util')
  assert.equal(util?.depth, 1)
  const x = rows.find(row => row.kind === 'file' && row.path === 'src/util/x.ts')
  assert.equal(x?.depth, 2)
})

test('buildDiffTreeRows collapse of a parent hides nested directories too', () => {
  const rows = buildDiffTreeRows(
    [{ path: 'src/util/x.ts' }, { path: 'src/a.ts' }, { path: 'README.md' }],
    null,
    new Set(['src']),
  )
  assert.deepEqual(rows.map(row => row.path), ['src', 'README.md'])
})

test('buildDiffTreeRows handles top-level files with no directories', () => {
  const rows = buildDiffTreeRows([{ path: 'a.ts' }, { path: 'b.ts' }], null, new Set())
  assert.equal(rows.length, 2)
  assert.equal(rows.every(row => row.kind === 'file'), true)
  assert.equal(rows.every(row => row.depth === 0), true)
})

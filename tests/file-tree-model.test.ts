import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkspaceFileEntry } from '../plugins/sidebar/src/protocol.ts'
import { buildFileRows } from '../plugins/sidebar/src/client/files/file-tree-model.ts'

function dir(path: string, name: string): WorkspaceFileEntry {
  return { kind: 'directory', name, path, size: null }
}

function file(path: string, name: string, size = 10): WorkspaceFileEntry {
  return { kind: 'file', name, path, size }
}

const entries: WorkspaceFileEntry[] = [
  dir('/w/src', 'src'),
  dir('/w/docs', 'docs'),
  file('/w/a.ts', 'a.ts'),
  file('/w/b.ts', 'b.ts'),
]
const srcEntries: WorkspaceFileEntry[] = [
  dir('/w/src/nested', 'nested'),
  file('/w/src/index.ts', 'index.ts'),
]
const nestedEntries: WorkspaceFileEntry[] = [
  file('/w/src/nested/deep.ts', 'deep.ts'),
]

const cache = new Map<string, readonly WorkspaceFileEntry[]>([
  ['/w', entries],
  ['/w/src', srcEntries],
  ['/w/src/nested', nestedEntries],
])

function rows(expandedDirs: ReadonlySet<string> = new Set(), selected: string | null = null) {
  return buildFileRows({
    currentPath: '/w',
    entriesByDir: cache,
    expandedDirs,
    selectedPath: selected,
  })
}

test('collapsed tree lists the root level only', () => {
  const out = rows()
  assert.deepEqual(
    out.map(row => [row.name, row.depth]),
    [['docs', 0], ['src', 0], ['a.ts', 0], ['b.ts', 0]],
  )
})

test('expanded directories recurse at depth', () => {
  const out = rows(new Set(['/w/src', '/w/src/nested']))
  assert.deepEqual(
    out.map(row => [row.name, row.depth]),
    [
      ['docs', 0],
      ['src', 0],
      ['nested', 1],
      ['deep.ts', 2],
      ['index.ts', 1],
      ['a.ts', 0],
      ['b.ts', 0],
    ],
  )
})

test('rows carry expanded/selected flags', () => {
  const out = rows(new Set(['/w/src']), '/w/a.ts')
  const src = out.find(row => row.name === 'src')
  const a = out.find(row => row.name === 'a.ts')
  assert.equal(src?.expanded, true)
  assert.equal(a?.selected, true)
  assert.equal(out.find(row => row.name === 'docs')?.expanded, false)
})

test('unloaded directories render one row without children', () => {
  const out = rows(new Set(['/w/docs'])) // docs has no cache entry yet
  assert.equal(out.find(row => row.name === 'docs')?.expanded, true)
  assert.equal(out.filter(row => row.depth > 0).length, 0)
})

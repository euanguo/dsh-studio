import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkspaceChange } from '../plugins/desktop-sidebar/src/protocol.ts'
import {
  buildSourceControlTree,
  canDiscardChange,
  canStageChange,
  canUnstageChange,
  collectDiscardPaths,
  collectStagePaths,
  collectUnstagePaths,
  flattenSourceControlTree,
  sectionOfChange,
} from '../plugins/desktop-sidebar/src/client/source-control-tree.ts'
import {
  buildSourceControlRows,
  type FileRow,
} from '../plugins/desktop-sidebar/src/client/source-control-view-model.ts'

function change(path: string, status: WorkspaceChange['status'], staged: boolean): WorkspaceChange {
  return { path, oldPath: null, status, staged, additions: 0, deletions: 0 }
}

test('buildSourceControlTree nests paths with depth and fileCount', () => {
  const tree = buildSourceControlTree([
    change('src/client/a.ts', 'modified', false),
    change('src/client/b.ts', 'added', false),
    change('src/server/c.ts', 'modified', false),
    change('README.md', 'modified', false),
  ])
  // dirs first, then files; each dir sorted
  assert.equal(tree.length, 2)
  const src = tree[0]!
  assert.equal(src.kind, 'directory')
  if (src.kind !== 'directory') return
  assert.equal(src.name, 'src')
  assert.equal(src.depth, 0)
  assert.equal(src.fileCount, 3)
  const client = src.children[0]!
  assert.equal(client.kind, 'directory')
  if (client.kind !== 'directory') return
  assert.equal(client.depth, 1)
  assert.deepEqual(client.children.map(node => node.name), ['a.ts', 'b.ts'])
  const readme = tree[1]!
  assert.equal(readme.kind, 'file')
})

test('compactNode merges single-child directory chains', () => {
  const tree = buildSourceControlTree([
    change('src/components/button.tsx', 'modified', false),
    change('src/components/icon.tsx', 'modified', false),
  ])
  assert.equal(tree.length, 1)
  const dir = tree[0]!
  assert.equal(dir.kind, 'directory')
  if (dir.kind !== 'directory') return
  assert.equal(dir.name, 'src/components')
  assert.equal(dir.depth, 0)
})

test('flattenSourceControlTree honors collapsed directories', () => {
  const tree = buildSourceControlTree([
    change('a/x.ts', 'modified', false),
    change('a/y.ts', 'modified', false),
    change('b.ts', 'modified', false),
  ])
  const collapsed = flattenSourceControlTree(tree, new Set([tree[0]!.key]))
  assert.deepEqual(
    collapsed.map(node => node.kind === 'file' ? node.path : node.path),
    ['a', 'b.ts'],
  )
})

test('sectionOfChange classifies into the two areas', () => {
  // Two-area layout: everything staged → 'staged'; everything else
  // (conflicts, untracked, worktree edits) → 'unstaged'.
  assert.equal(sectionOfChange(change('x', 'modified', true)), 'staged')
  assert.equal(sectionOfChange(change('x', 'added', true)), 'staged')
  assert.equal(sectionOfChange(change('x', 'conflicted', false)), 'unstaged')
  assert.equal(sectionOfChange(change('x', 'untracked', false)), 'unstaged')
  assert.equal(sectionOfChange(change('x', 'modified', false)), 'unstaged')
  assert.equal(sectionOfChange(change('x', 'deleted', false)), 'unstaged')
})

test('capability matrix: stage / unstage / discard', () => {
  const modified = change('a', 'modified', false)
  const staged = change('a', 'modified', true)
  const untracked = change('a', 'untracked', false)
  const conflicted = change('a', 'conflicted', false)
  assert.equal(canStageChange(modified), true)
  assert.equal(canStageChange(staged), false)
  assert.equal(canStageChange(untracked), true)
  assert.equal(canStageChange(conflicted), false)
  assert.equal(canUnstageChange(staged), true)
  assert.equal(canUnstageChange(modified), false)
  assert.equal(canDiscardChange(modified), true)
  assert.equal(canDiscardChange(untracked), true)
  assert.equal(canDiscardChange(staged), false)
  assert.equal(canDiscardChange(conflicted), false)
})

test('directory batch paths aggregate the subtree', () => {
  const tree = buildSourceControlTree([
    change('src/a.ts', 'modified', false),
    change('src/b.ts', 'modified', true),
    change('src/c.ts', 'untracked', false),
  ])
  const dir = tree[0]!
  assert.equal(dir.kind, 'directory')
  if (dir.kind !== 'directory') return
  assert.deepEqual(collectStagePaths(dir), ['src/a.ts', 'src/c.ts'])
  assert.deepEqual(collectUnstagePaths(dir), ['src/b.ts'])
  assert.deepEqual(collectDiscardPaths(dir), ['src/a.ts', 'src/c.ts'])
})

test('buildSourceControlRows emits the two areas with tree grouping', () => {
  const rows = buildSourceControlRows({
    changes: [
      change('conflict.txt', 'conflicted', false),
      change('staged.txt', 'modified', true),
      change('deep/nested/file.txt', 'added', false),
      change('untracked.txt', 'untracked', false),
    ],
    collapsedSections: new Set(),
    collapsedDirectories: new Set(),
    selectedPath: 'staged.txt',
    mode: 'tree',
  })
  const kinds = rows.map(row => row.kind)
  assert.deepEqual(kinds, [
    'section', 'file', // staged
    'section', 'directory', 'file', 'file', 'file', // unstaged: deep/nested tree + conflict + untracked
  ])
  const staged = rows.find(row => row.kind === 'file' && row.path === 'staged.txt') as FileRow
  assert.equal(staged.selected, true)
  assert.equal(staged.canUnstage, true)

  const unstagedSection = rows[2]!
  assert.equal(unstagedSection.kind, 'section')
  if (unstagedSection.kind !== 'section') return
  assert.equal(unstagedSection.count, 3)
  // Conflicted files cannot be staged — only the added file and the
  // untracked file are stage candidates.
  assert.deepEqual(unstagedSection.stagePaths, [
    'deep/nested/file.txt',
    'untracked.txt',
  ])
})

test('flat mode emits one plain row per change without directories', () => {
  const rows = buildSourceControlRows({
    changes: [
      change('deep/nested/a.ts', 'modified', false),
      change('deep/nested/b.ts', 'added', false),
      change('staged.txt', 'modified', true),
    ],
    collapsedSections: new Set(),
    collapsedDirectories: new Set(),
    selectedPath: null,
    mode: 'flat',
  })
  assert.deepEqual(
    rows.map(row => row.kind === 'file' ? `file:${row.path}@${row.depth}` : row.kind),
    ['section', 'file:staged.txt@0', 'section', 'file:deep/nested/a.ts@0', 'file:deep/nested/b.ts@0'],
  )
  const unstaged = rows.find(row => row.kind === 'file' && row.path === 'deep/nested/a.ts') as FileRow
  assert.equal(unstaged.name, 'a.ts')
})

test('collapsed sections emit only section rows (both areas)', () => {
  const rows = buildSourceControlRows({
    changes: [change('a.ts', 'modified', false)],
    collapsedSections: new Set(['unstaged']),
    collapsedDirectories: new Set(),
    selectedPath: null,
    mode: 'tree',
  })
  assert.deepEqual(rows.map(row => row.kind), [
    'section', // staged (0)
    'section', // unstaged (1, collapsed)
  ])
})

test('collapsed directories keep directory rows but skip files', () => {
  const rows = buildSourceControlRows({
    changes: [
      change('dir/a.ts', 'modified', false),
      change('top.ts', 'modified', false),
    ],
    collapsedSections: new Set(),
    collapsedDirectories: new Set(['directory:dir']),
    selectedPath: null,
    mode: 'tree',
  })
  assert.deepEqual(
    rows.map(row => row.kind === 'file' ? `file:${row.path}` : row.kind),
    ['section', 'section', 'directory', 'file:top.ts'],
  )
})

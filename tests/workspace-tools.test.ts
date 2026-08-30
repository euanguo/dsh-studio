import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import {
  mutateWorkspace,
  readWorkspaceFacts,
} from '../plugins/capabilities/src/workspace-git.ts'
import {
  isCapabilitiesWorkspaceMutation,
} from '../plugins/shared/contracts/capabilities-api.ts'
import {
  mapSidebarFile,
  mapSidebarTree,
  workspaceChangesFromWire,
} from '../plugins/sidebar/src/client/sidebar-api.ts'

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout
}

test('workspace mutation wire guard accepts the host vocabulary only', () => {
  assert.equal(isCapabilitiesWorkspaceMutation({ action: 'push' }), true)
  assert.equal(isCapabilitiesWorkspaceMutation({ action: 'create-branch', branch: 'x' }), true)
  assert.equal(isCapabilitiesWorkspaceMutation({ action: 'checkout', branch: 'x' }), false)
  assert.equal(isCapabilitiesWorkspaceMutation({ action: 'create-branch' }), false)
  assert.equal(isCapabilitiesWorkspaceMutation(null), false)
  assert.equal(isCapabilitiesWorkspaceMutation('push'), false)
})

test('workspace extension provides repository facts and branch creation', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dsh-studio-workspace-tools-'))
  try {
    git(workspace, ['init', '-b', 'main'])
    git(workspace, ['config', 'user.name', 'Oh DSH Test'])
    git(workspace, ['config', 'user.email', 'dsh-studio@example.test'])
    writeFileSync(join(workspace, 'README.md'), 'first\n')
    git(workspace, ['add', 'README.md'])
    git(workspace, ['commit', '-m', 'initial'])
    const facts = await readWorkspaceFacts(workspace)
    assert.equal(facts.kind, 'repository')
    assert.equal(facts.name, basename(workspace))
    assert.equal(facts.hasRemote, false)

    const branched = await mutateWorkspace(workspace, { action: 'create-branch', branch: 'panel-test' })
    assert.equal(branched.facts.kind, 'repository')
    assert.equal(git(workspace, ['branch', '--show-current']).trim(), 'panel-test')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Better Sidebar status maps into the DSH Studio workspace model', () => {
  assert.deepEqual(workspaceChangesFromWire([
    { path: 'staged.ts', xy: 'M ' },
    { path: 'renamed.ts', xy: 'R ' },
    { path: 'loose.txt', xy: '??' },
  ]), [
    { path: 'loose.txt', oldPath: null, status: 'untracked', staged: false, additions: 0, deletions: 0 },
    { path: 'renamed.ts', oldPath: null, status: 'renamed', staged: true, additions: 0, deletions: 0 },
    { path: 'staged.ts', oldPath: null, status: 'modified', staged: true, additions: 0, deletions: 0 },
  ])
})

test('porcelain v2 XY codes map staged/unstaged correctly', () => {
  // v2 uses '.' for the unmodified index slot — `.M` is an UNSTAGED change,
  // `M.` is staged. Both must land in the right section (and diff side).
  assert.deepEqual(workspaceChangesFromWire([
    { path: 'unstaged.ts', xy: '.M' },
    { path: 'staged.ts', xy: 'M.' },
    { path: 'both.ts', xy: 'MM' },
  ]).map(change => [change.path, change.staged]), [
    ['both.ts', true],
    ['staged.ts', true],
    ['unstaged.ts', false],
  ])
})

test('workspace files adapt Better Sidebar responses to the DSH Studio UI', () => {
  const root = mapSidebarTree('/workspace', {
    path: '/workspace/src',
    entries: [
      { name: 'nested', path: '/workspace/src/nested', isDir: true, hidden: false },
      { name: 'index.ts', path: '/workspace/src/index.ts', isDir: false, hidden: false },
    ],
    truncated: false,
  })
  assert.equal(root.kind, 'directory')
  if (root.kind !== 'directory') return
  assert.equal(root.parent, '/workspace')
  assert.deepEqual(root.entries.map(entry => [entry.name, entry.kind]), [
    ['nested', 'directory'],
    ['index.ts', 'file'],
  ])
  const preview = mapSidebarFile('/workspace', '/workspace/src/index.ts', {
    kind: 'text',
    content: 'export const ready = true\n',
    truncated: false,
  })
  assert.equal(preview.kind, 'file')
  if (preview.kind === 'file') assert.match(preview.content ?? '', /ready = true/)
})

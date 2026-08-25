import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWorktreeList } from '../plugins/shared/git/git-core.ts'

test('parseWorktreeList: main + linked worktrees', () => {
  const out = [
    'worktree /Users/me/repos/dsh-studio',
    'HEAD 47f943859bef60e4160492346772ded9b24f765a',
    'branch refs/heads/main',
    '',
    'worktree /Users/me/repos/dsh-studio-worktrees/feat-api',
    'HEAD abc123def4567890abcdef1234567890abcdef12',
    'branch refs/heads/feat/api',
    '',
  ].join('\n')
  const entries = parseWorktreeList(out)
  assert.equal(entries.length, 2)
  assert.deepEqual(entries[0], {
    path: '/Users/me/repos/dsh-studio',
    head: '47f943859bef60e4160492346772ded9b24f765a',
    branch: 'main',
    main: true,
  })
  assert.deepEqual(entries[1], {
    path: '/Users/me/repos/dsh-studio-worktrees/feat-api',
    head: 'abc123def4567890abcdef1234567890abcdef12',
    branch: 'feat/api',
    main: false,
  })
})

test('parseWorktreeList: detached linked worktree (no branch line)', () => {
  const out = [
    'worktree /repo/main',
    'HEAD aaaa',
    'branch refs/heads/main',
    '',
    'worktree /repo/detached',
    'HEAD bbbb',
    '',
  ].join('\n')
  const entries = parseWorktreeList(out)
  assert.equal(entries.length, 2)
  assert.equal(entries[1]!.branch, null)
  assert.equal(entries[1]!.main, false)
})

test('parseWorktreeList: bare repository (no HEAD lines)', () => {
  const out = ['worktree /srv/git/repo.git', ''].join('\n')
  const entries = parseWorktreeList(out)
  assert.equal(entries.length, 1)
  assert.equal(entries[0]!.head, null)
  assert.equal(entries[0]!.branch, null)
  assert.equal(entries[0]!.main, true)
})


test('parseWorktreeList: preserves locked and prunable safety facts', () => {
  const entries = parseWorktreeList([
    'worktree /repo/main',
    'HEAD aaaa',
    'branch refs/heads/main',
    '',
    'worktree /repo/linked',
    'HEAD bbbb',
    'branch refs/heads/feature',
    'locked manual hold',
    'prunable missing directory',
  ].join('\n'))
  assert.equal(entries[1]?.locked, true)
  assert.equal(entries[1]?.prunable, 'missing directory')
})

test('worktreeAdd refuses option-shaped refspecs before spawning git', async () => {
  const { worktreeAdd } = await import('../plugins/shared/git/git-core.ts')
  await assert.rejects(
    worktreeAdd('/tmp', '/tmp/wt', '--force', true),
    /must not start with "-"/,
  )
  await assert.rejects(
    worktreeAdd('/tmp', '/tmp/wt', 'ok-branch', true, '-c core.editor=pwned'),
    /must not start with "-"/,
  )
  await assert.rejects(
    worktreeAdd('/tmp', '/tmp/wt', '-b', false),
    /must not start with "-"/,
  )
})

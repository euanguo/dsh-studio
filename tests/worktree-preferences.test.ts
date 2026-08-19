import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  WORKTREE_NAME_FALLBACK,
  WORKTREE_STORE_DIR_NAME,
  computeWorktreeLocation,
  resolveDefaultWorktreeRoot,
  sanitizeWorktreeDir,
  slugifyWorktreeName,
} from '@dsh-studio/shared/worktree-preferences'
import {
  DEFAULT_DSH_STUDIO_DEV_HOME_DIRECTORY,
  DEFAULT_DSH_STUDIO_HOME_DIRECTORY,
  DSH_STUDIO_CHANNEL_ENV,
  DSH_STUDIO_HOME_ENV,
} from '@dsh-studio/shared/data-root-names'

/* ── sanitizeWorktreeDir ──────────────────────────────────────────── */

test('sanitizeWorktreeDir accepts absolute paths and normalizes separators', () => {
  assert.equal(sanitizeWorktreeDir('/Volumes/Worktrees'), '/Volumes/Worktrees')
  assert.equal(sanitizeWorktreeDir('  /Volumes/Worktrees/  '), '/Volumes/Worktrees')
  assert.equal(sanitizeWorktreeDir('\\srv\\share\\wt'), '/srv/share/wt')
  assert.equal(sanitizeWorktreeDir('C:\\dev\\worktrees'), 'C:/dev/worktrees')
  assert.equal(sanitizeWorktreeDir('C:/dev/worktrees/'), 'C:/dev/worktrees')
})

test('sanitizeWorktreeDir rejects relative, empty, and non-string values', () => {
  assert.equal(sanitizeWorktreeDir('relative/path'), undefined)
  assert.equal(sanitizeWorktreeDir('./here'), undefined)
  assert.equal(sanitizeWorktreeDir(''), undefined)
  assert.equal(sanitizeWorktreeDir('   '), undefined)
  assert.equal(sanitizeWorktreeDir(42), undefined)
  assert.equal(sanitizeWorktreeDir(null), undefined)
  assert.equal(sanitizeWorktreeDir(undefined), undefined)
})

/* ── slugifyWorktreeName (Orca rule: Unicode-preserving) ─────────── */

test('slugifyWorktreeName keeps Unicode letters/numbers and folds the rest', () => {
  // A slash is not a safe directory segment: branch names collapse flat.
  assert.equal(slugifyWorktreeName('feat/login'), 'feat-login')
  assert.equal(slugifyWorktreeName('Fix: the "broken" thing?'), 'Fix-the-broken-thing')
  assert.equal(slugifyWorktreeName('fix   spaces \t here'), 'fix-spaces-here')
  assert.equal(slugifyWorktreeName('功能/登录'), '功能-登录')
  assert.equal(slugifyWorktreeName('..逃逸..'), '逃逸')
  assert.equal(slugifyWorktreeName('-trim.-'), 'trim')
  assert.equal(slugifyWorktreeName('...'), '')
  assert.equal(slugifyWorktreeName('///'), '')
})

/* ── computeWorktreeLocation (Orca naming rule) ──────────────────── */

test('computeWorktreeLocation nests under the repo-name subfolder by default', () => {
  assert.equal(computeWorktreeLocation({
    root: '/data/worktrees', nest: true, repoRoot: '/work/my-project', name: 'feat/login',
  }), '/data/worktrees/my-project/feat-login')
})

test('computeWorktreeLocation strips a .git suffix from the repo name', () => {
  assert.equal(computeWorktreeLocation({
    root: '/data/worktrees', nest: true, repoRoot: '/work/my-project.git', name: 'feat',
  }), '/data/worktrees/my-project/feat')
})

test('computeWorktreeLocation goes flat when nesting is off', () => {
  assert.equal(computeWorktreeLocation({
    root: '/data/worktrees', nest: false, repoRoot: '/work/my-project', name: 'feat/login',
  }), '/data/worktrees/feat-login')
})

test('computeWorktreeLocation falls back to the new placeholder for empty slugs', () => {
  assert.equal(computeWorktreeLocation({
    root: '/data/worktrees', nest: true, repoRoot: '/work/my-project', name: '  ',
  }), `/data/worktrees/my-project/${WORKTREE_NAME_FALLBACK}`)
  // A repo name that slugifies to nothing (e.g. '...') keeps the flat form.
  assert.equal(computeWorktreeLocation({
    root: '/data/worktrees', nest: true, repoRoot: '/work/...', name: 'feat',
  }), '/data/worktrees/feat')
})

/* ── resolveDefaultWorktreeRoot (data-root derivation) ───────────── */

test('resolveDefaultWorktreeRoot honors the DSH_STUDIO_HOME override', () => {
  assert.equal(
    resolveDefaultWorktreeRoot({ [DSH_STUDIO_HOME_ENV]: '/custom/root' }, '/Users/dev'),
    `/custom/root/${WORKTREE_STORE_DIR_NAME}`,
  )
})

test('resolveDefaultWorktreeRoot derives the stable/dev sibling pair when the override is absent', () => {
  assert.equal(
    resolveDefaultWorktreeRoot({}, '/Users/dev'),
    `/Users/dev/${DEFAULT_DSH_STUDIO_HOME_DIRECTORY}/${WORKTREE_STORE_DIR_NAME}`,
  )
  assert.equal(
    resolveDefaultWorktreeRoot({ [DSH_STUDIO_CHANNEL_ENV]: 'dev' }, '/Users/dev'),
    `/Users/dev/${DEFAULT_DSH_STUDIO_DEV_HOME_DIRECTORY}/${WORKTREE_STORE_DIR_NAME}`,
  )
})

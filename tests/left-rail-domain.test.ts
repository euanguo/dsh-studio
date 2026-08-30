import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ProjectNode, SessionNode, WorktreeNode } from '../plugins/desktop-left-rail/src/client/tree.ts'
import { isPathWithin, normalizePath, projectIdentityKey, railExpansionKey, type ProjectId } from '../plugins/desktop-left-rail/src/client/domain/identities.ts'
import { resolveProjectIcon, sanitizeProjectIconPreference } from '../plugins/desktop-left-rail/src/client/domain/project-icon.ts'
import { getWorktreeRemovalDecision } from '../plugins/desktop-left-rail/src/client/domain/worktree-policy.ts'
import { createRailController } from '../plugins/desktop-left-rail/src/client/rail-controller.ts'

const project: ProjectNode = {
  key: '/repo', repoRoot: '/repo', label: 'repo', isGit: true, mainBranch: 'main',
  worktrees: [], worktreeCount: 0, activity: { waiting: 0, running: 0, completed: 0 },
  expanded: false, containsCurrent: false,
}

function session(id: string, running = false): SessionNode {
  return {
    id: id as SessionId, title: id, blank: false,
    running, runningSubagentCount: 0, completed: false, updatedAt: 0,
  }
}

function worktree(overrides: Partial<WorktreeNode> = {}): WorktreeNode {
  return {
    key: '/repo-feature', path: '/repo-feature', label: 'feature', branch: 'feature', main: false,
    workspaceIds: [], sessions: [], sessionCount: 0,
    activity: { waiting: 0, running: 0, completed: 0 }, expanded: false, containsCurrent: false,
    ...overrides,
  }
}

function gitFact(path = '/repo-feature') {
  return {
    status: 'ready' as const,
    kind: 'git' as const,
    layout: { repoRoot: '/repo', worktrees: [{ path: '/repo', head: 'a', branch: 'main', main: true }, { path, head: 'b', branch: 'feature', main: false }] },
  }
}

test('identity paths normalize separators and preserve segment boundaries', () => {
  assert.equal(normalizePath('/repo/./src/../'), '/repo')
  assert.equal(normalizePath('C:\\repo\\feature'), 'C:/repo/feature')
  assert.equal(isPathWithin('/repo', '/repo/src'), true)
  assert.equal(isPathWithin('/repo', '/repo-old/src'), false)
  assert.equal(projectIdentityKey({ kind: 'git', repoRoot: '/repo/.' }), 'git:/repo')
  assert.equal(railExpansionKey({ kind: 'project', id: { kind: 'directory', path: '/plain' } }), 'project:directory:/plain')
})

test('project icon precedence chooses override, then host candidates, then fallback', () => {
  const id: ProjectId = { kind: 'git', repoRoot: '/repo' }
  assert.equal(resolveProjectIcon({ project: id, preference: { kind: 'builtin', name: 'git' }, candidates: [], fallback: 'project' }).source, 'override')
  assert.equal(resolveProjectIcon({ project: id, candidates: [
    { source: 'git-provider-avatar', value: 'avatar' },
    { source: 'homepage-favicon', value: 'favicon' },
    { source: 'local-png', value: 'local' },
  ], fallback: 'project' }).value, 'local')
  assert.equal(resolveProjectIcon({ project: id, candidates: [], fallback: 'directory' }).value, 'directory')
})

test('project icon preferences reject unknown builtins and oversized/non-PNG uploads', () => {
  assert.equal(sanitizeProjectIconPreference({ kind: 'builtin', name: 'star' }), undefined)
  assert.equal(sanitizeProjectIconPreference({ kind: 'upload', mime: 'image/png', data: 'data:image/svg+xml;base64,AA==' }), undefined)
  assert.deepEqual(sanitizeProjectIconPreference({ kind: 'builtin', name: 'git' }), { kind: 'builtin', name: 'git' })
})

test('worktree removal rejects the main worktree', () => {
  const decision = getWorktreeRemovalDecision({ project, worktree: worktree({ main: true }), gitFact: gitFact(), targetIsCurrent: false })
  assert.deepEqual(decision, { eligible: false, reason: 'main-worktree', error: { code: 'main-worktree', message: 'The main worktree cannot be removed.' } })
})

test('worktree removal rejects a synthetic non-Git worktree', () => {
  const decision = getWorktreeRemovalDecision({ project: { ...project, isGit: false }, worktree: worktree({ main: false }), gitFact: { status: 'ready', kind: 'directory' }, targetIsCurrent: false })
  assert.equal(decision.eligible, false)
  assert.equal(decision.reason, 'non-git-project')
})


test('rail controller serializes physical removal per worktree and refreshes once per success', async () => {
  let active = 0
  let maxActive = 0
  let refreshes = 0
  const controller = createRailController({
    preview: async () => ({
      repoRoot: '/repo', path: '/repo-feature', branch: 'feature', main: false,
      locked: false, prunable: null, dirty: false, statusEntries: [],
    }),
    remove: async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active -= 1
      return null
    },
    refresh: () => { refreshes += 1 },
  })
  await Promise.all([
    controller.removePhysicalWorktree('/repo', '/repo-feature', false),
    controller.removePhysicalWorktree('/repo', '/repo-feature', false),
  ])
  assert.equal(maxActive, 1)
  assert.equal(refreshes, 2)
})

test('worktree removal rejects stale and active targets, permits idle linked worktrees', () => {
  const stale = getWorktreeRemovalDecision({ project, worktree: worktree(), gitFact: gitFact('/different'), targetIsCurrent: false })
  assert.equal(stale.reason, 'stale-target')
  const active = getWorktreeRemovalDecision({ project, worktree: worktree({ sessions: [session('s1', true)] }), gitFact: gitFact(), targetIsCurrent: false })
  assert.equal(active.reason, 'active-session')
  const idle = getWorktreeRemovalDecision({ project, worktree: worktree({ workspaceIds: ['ws-1' as WorkspaceId] }), gitFact: gitFact(), targetIsCurrent: false })
  assert.deepEqual(idle, { eligible: true, requiresConfirmation: true, reason: 'linked-worktree' })
})

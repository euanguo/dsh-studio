/**
 * Left-rail tree derivation tests (pure, no render machinery).
 *
 * These tests pin the desktop three-level tree semantics the P0–P1 fixes
 * rest on: session overflow visibility derives from expansion keys, worktree
 * rows address every member workspace, non-git directories carry no git
 * "main" marker, and projects assigned to a vanished group fall back to the
 * pinned tab instead of disappearing.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SessionId, SessionListState, SessionSummary, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionNode } from '../plugins/desktop-left-rail/src/client/tree.ts'
import {
  deriveFlat, deriveGroups, deriveProjectTree, deriveSearchResults,
  relativeTime, repoExpansionKey, UNGROUPED_EXPANSION_KEY, UNGROUPED_KEY,
  UNGROUPED_LABEL, worktreeExpansionKey, worktreeVisibleSessions, workspaceExpansionKey, workspaceLabel,
} from '../plugins/desktop-left-rail/src/client/tree.ts'
import { indexSubagentDescendants } from '../plugins/desktop-left-rail/src/client/subagent-lineage.ts'

/* ------------------------------------------------------------------------- *
 * Fixtures
 * ------------------------------------------------------------------------- */

function summary(id: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: id as SessionId,
    displayTitle: `title-${id}`,
    running: false,
    blank: false,
    updatedAt: 1_000,
    ...overrides,
  }
}

function node(id: string): SessionNode {
  return {
    id: id as SessionId,
    title: `title-${id}`,
    blank: false,
    running: false,
    runningSubagentCount: 0,
    completed: false,
    updatedAt: 1_000,
  }
}

function listState(byId: Record<string, SessionSummary>, current?: string): SessionListState {
  return {
    ids: Object.keys(byId) as SessionId[],
    byId: byId as SessionListState['byId'],
    current: current as SessionId | undefined,
    currentAddress: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
  }
}

function workspace(
  id: string,
  path: string,
  sessionIds: readonly string[],
  title?: string,
): WorkspaceView {
  return {
    workspaceId: id as WorkspaceId,
    path,
    title: title ?? path.split('/').pop() ?? path,
    sessionIds: [...sessionIds] as SessionId[],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function layout(repoRoot: string, worktrees: readonly { path: string; branch: string | null; main: boolean }[]) {
  return { repoRoot, worktrees: worktrees.map(wt => ({ ...wt, head: null })) }
}

const layouts = new Map<string, ReturnType<typeof layout> | null>()

/* ------------------------------------------------------------------------- *
 * indexSubagentDescendants (vendored upstream semantics)
 * ------------------------------------------------------------------------- */

test('lineage: ordinary sessions never enter the index', () => {
  const byId = {
    'a': summary('a'),
    'b': summary('b'),
  }
  const indexed = indexSubagentDescendants(byId as Record<SessionId, SessionSummary>)
  assert.equal(indexed.size, 0)
})

test('lineage: uninterrupted subagent chains aggregate count and running totals', () => {
  const byId = {
    'a': summary('a'),
    's1': summary('s1', { origin: 'subagent', parentId: 'a' as SessionId, running: true }),
    's2': summary('s2', { origin: 'subagent', parentId: 's1' as SessionId, running: false }),
  }
  const indexed = indexSubagentDescendants(byId as Record<SessionId, SessionSummary>)
  assert.deepEqual(indexed.get('a' as SessionId), { count: 2, runningCount: 1 })
  assert.deepEqual(indexed.get('s1' as SessionId), { count: 1, runningCount: 0 })
})

test('lineage: an ordinary fork between subagents breaks the chain', () => {
  const byId = {
    'a': summary('a'),
    's1': summary('s1', { origin: 'subagent', parentId: 'a' as SessionId }),
    'b': summary('b', { parentId: 's1' as SessionId }),
    's2': summary('s2', { origin: 'subagent', parentId: 'b' as SessionId }),
  }
  const indexed = indexSubagentDescendants(byId as Record<SessionId, SessionSummary>)
  // s1 reaches a (its parent is ordinary); s2 stops at the ordinary b and
  // never propagates to a through the fork.
  assert.deepEqual(indexed.get('a' as SessionId), { count: 1, runningCount: 0 })
  assert.deepEqual(indexed.get('b' as SessionId), { count: 1, runningCount: 0 })
})

/* ------------------------------------------------------------------------- *
 * deriveGroups
 * ------------------------------------------------------------------------- */

test('deriveGroups: empty list yields no groups', () => {
  assert.deepEqual(deriveGroups(listState({}), [], [], { expandedGroups: [] }), [])
})

test('deriveGroups: expanded workspace group carries its session rows', () => {
  const list = listState({ 's1': summary('s1'), 's2': summary('s2') })
  const ws = [workspace('ws-1', '/repo', ['s1', 's2'])]
  const groups = deriveGroups(list, ws, [], {
    expandedGroups: [workspaceExpansionKey('ws-1')],
  })
  assert.equal(groups.length, 1)
  assert.equal(groups[0]!.workspaceId, 'ws-1')
  assert.equal(groups[0]!.sessionCount, 2)
  assert.deepEqual(groups[0]!.sessions.map(s => s.id), ['s1', 's2'])
  assert.equal(groups[0]!.containsCurrent, false)
})

test('deriveGroups: a collapsed group yields no session rows but keeps its count', () => {
  const list = listState({ 's1': summary('s1') })
  const groups = deriveGroups(list, [workspace('ws-1', '/repo', ['s1'])], [], {
    expandedGroups: [],
  })
  assert.equal(groups[0]!.sessionCount, 1)
  assert.deepEqual(groups[0]!.sessions, [])
})

test('deriveGroups: expansion keys are namespaced — the raw workspace id does not expand', () => {
  const list = listState({ 's1': summary('s1') })
  const groups = deriveGroups(list, [workspace('ws-1', '/repo', ['s1'])], [], {
    expandedGroups: ['ws-1'],
  })
  assert.deepEqual(groups[0]!.sessions, [])
})

test('deriveGroups: stray sessions trail under the ungrouped bucket', () => {
  const list = listState({ 's1': summary('s1'), 's2': summary('s2') })
  const groups = deriveGroups(list, [workspace('ws-1', '/repo', ['s1'])], [], {
    expandedGroups: [workspaceExpansionKey('ws-1'), UNGROUPED_EXPANSION_KEY],
  })
  assert.equal(groups.length, 2)
  assert.equal(groups[1]!.workspaceId, undefined)
  assert.equal(groups[1]!.key, UNGROUPED_KEY)
  assert.deepEqual(groups[1]!.sessions.map(s => s.id), ['s2'])
})

test('deriveGroups: archived and non-current blank sessions are hidden', () => {
  const list = listState({
    's1': summary('s1'),
    's2': summary('s2'),
    's3': summary('s3', { blank: true }),
    's4': summary('s4', { blank: true }),
  }, 's3')
  const groups = deriveGroups(list, [workspace('ws-1', '/repo', ['s1', 's2', 's3', 's4'])], ['s2'] as SessionId[], {
    expandedGroups: [workspaceExpansionKey('ws-1')],
  })
  assert.deepEqual(groups[0]!.sessions.map(s => s.id), ['s1', 's3'])
})

test('deriveGroups: containsCurrent marks the group owning the selected session', () => {
  const list = listState({ 's1': summary('s1'), 's2': summary('s2') }, 's2')
  const groups = deriveGroups(list, [workspace('ws-1', '/repo', ['s1'])], [], {
    expandedGroups: [],
  })
  assert.equal(groups[0]!.containsCurrent, false)
  const owned = deriveGroups(list, [workspace('ws-1', '/repo', ['s2'])], [], { expandedGroups: [] })
  assert.equal(owned[0]!.containsCurrent, true)
})

/* ------------------------------------------------------------------------- *
 * deriveProjectTree — the desktop three-level tree
 * ------------------------------------------------------------------------- */

test('deriveProjectTree: workspaces of one repo group under one project with per-worktree rows', () => {
  layouts.clear()
  layouts.set('/repo', layout('/repo', [
    { path: '/repo', branch: 'main', main: true },
    { path: '/repo-worktrees/feat-a', branch: 'feat/a', main: false },
  ]))
  layouts.set('/repo-worktrees/feat-a', layout('/repo', [
    { path: '/repo', branch: 'main', main: true },
    { path: '/repo-worktrees/feat-a', branch: 'feat/a', main: false },
  ]))
  const list = listState({ 's1': summary('s1'), 's2': summary('s2') })
  const ws = [
    workspace('ws-main', '/repo', ['s1']),
    workspace('ws-feat', '/repo-worktrees/feat-a', ['s2']),
  ]
  const tree = deriveProjectTree(list, ws, layouts, [], {
    expanded: [repoExpansionKey('/repo'), worktreeExpansionKey('/repo'), worktreeExpansionKey('/repo-worktrees/feat-a')],
    activeTab: '__default__', projectGroup: {}, groupIds: [], groupLabels: {}, projectAlias: {},
  })
  assert.equal(tree.projects.length, 1)
  const project = tree.projects[0]!
  assert.equal(project.repoRoot, '/repo')
  assert.equal(project.isGit, true)
  assert.equal(project.mainBranch, 'main')
  assert.equal(project.worktreeCount, 2)
  assert.equal(project.worktrees[0]!.main, true)
  assert.equal(project.worktrees[0]!.branch, 'main')
  assert.deepEqual(project.worktrees[0]!.sessions.map(s => s.id), ['s1'])
  assert.equal(project.worktrees[1]!.main, false)
  assert.equal(project.worktrees[1]!.branch, 'feat/a')
  assert.deepEqual(project.worktrees[1]!.sessions.map(s => s.id), ['s2'])
})

test('deriveProjectTree: two workspaces in the SAME worktree both join the row', () => {
  layouts.clear()
  layouts.set('/repo', layout('/repo', [{ path: '/repo', branch: 'main', main: true }]))
  layouts.set('/repo/sub', layout('/repo', [{ path: '/repo', branch: 'main', main: true }]))
  const list = listState({ 's1': summary('s1'), 's2': summary('s2') })
  const ws = [
    workspace('ws-a', '/repo', ['s1']),
    workspace('ws-b', '/repo/sub', ['s2']),
  ]
  const tree = deriveProjectTree(list, ws, layouts, [], {
    expanded: [repoExpansionKey('/repo'), worktreeExpansionKey('/repo')],
    activeTab: '__default__', projectGroup: {}, groupIds: [], groupLabels: {}, projectAlias: {},
  })
  assert.equal(tree.projects.length, 1)
  const wt = tree.projects[0]!.worktrees[0]!
  assert.deepEqual(wt.workspaceIds, ['ws-a', 'ws-b'])
  assert.deepEqual(wt.sessions.map(s => s.id), ['s1', 's2'])
})

test('deriveProjectTree: a workspace inside a worktree subdirectory lands on the longest-prefix worktree', () => {
  layouts.clear()
  layouts.set('/repo', layout('/repo', [
    { path: '/repo', branch: 'main', main: true },
    { path: '/repo-worktrees/feat-a', branch: 'feat/a', main: false },
  ]))
  layouts.set('/repo-worktrees/feat-a/src', layout('/repo', [
    { path: '/repo', branch: 'main', main: true },
    { path: '/repo-worktrees/feat-a', branch: 'feat/a', main: false },
  ]))
  const list = listState({ 's1': summary('s1') })
  const ws = [workspace('ws-deep', '/repo-worktrees/feat-a/src', ['s1'])]
  const tree = deriveProjectTree(list, ws, layouts, [], {
    expanded: [repoExpansionKey('/repo'), worktreeExpansionKey('/repo-worktrees/feat-a')],
    activeTab: '__default__', projectGroup: {}, groupIds: [], groupLabels: {}, projectAlias: {},
  })
  const wt = tree.projects[0]!.worktrees.find(w => w.path === '/repo-worktrees/feat-a')
  assert.ok(wt !== undefined)
  assert.deepEqual(wt.workspaceIds, ['ws-deep'])
  assert.deepEqual(wt.sessions.map(s => s.id), ['s1'])
})

test('deriveProjectTree: a non-git directory is a single worktree without the main marker', () => {
  layouts.clear()
  layouts.set('/plain', null)
  const list = listState({ 's1': summary('s1') })
  const ws = [workspace('ws-plain', '/plain', ['s1'])]
  const tree = deriveProjectTree(list, ws, layouts, [], {
    expanded: [repoExpansionKey('/plain'), worktreeExpansionKey('/plain')],
    activeTab: '__default__', projectGroup: {}, groupIds: [], groupLabels: {}, projectAlias: {},
  })
  assert.equal(tree.projects.length, 1)
  const project = tree.projects[0]!
  assert.equal(project.isGit, false)
  assert.equal(project.worktreeCount, 1)
  const wt = project.worktrees[0]!
  assert.equal(wt.main, false)
  assert.equal(wt.branch, null)
  assert.deepEqual(wt.workspaceIds, ['ws-plain'])
})

test('deriveProjectTree: expansion keys are namespaced — raw paths do not expand', () => {
  layouts.clear()
  layouts.set('/repo', layout('/repo', [{ path: '/repo', branch: 'main', main: true }]))
  const list = listState({ 's1': summary('s1') })
  const ws = [workspace('ws-1', '/repo', ['s1'])]
  const tree = deriveProjectTree(list, ws, layouts, [], {
    expanded: ['/repo'],
    activeTab: '__default__', projectGroup: {}, groupIds: [], groupLabels: {}, projectAlias: {},
  })
  assert.equal(tree.projects[0]!.expanded, false)
  // Sessions always carry the full member list (the renderer crops the
  // collapsed preview); only the expansion flag is gated by the namespaced key.
  assert.deepEqual(tree.projects[0]!.worktrees[0]!.sessions.map(s => s.id), ['s1'])
})

test('deriveProjectTree: a project assigned to a vanished group falls back to the pinned tab', () => {
  layouts.clear()
  layouts.set('/repo', layout('/repo', [{ path: '/repo', branch: 'main', main: true }]))
  const list = listState({})
  const ws = [workspace('ws-1', '/repo', [])]
  const tree = deriveProjectTree(list, ws, layouts, [], {
    expanded: [], activeTab: '__default__',
    projectGroup: { '/repo': '__new__' }, groupIds: [], groupLabels: {}, projectAlias: {},
  })
  assert.equal(tree.projects.length, 1)
  assert.equal(tree.projects[0]!.repoRoot, '/repo')
})

test('deriveProjectTree: the pinned tab carries no label; user groups keep theirs', () => {
  const tree = deriveProjectTree(listState({}), [], new Map(), [], {
    expanded: [], activeTab: 'g-1',
    projectGroup: {}, groupIds: ['g-1'], groupLabels: { 'g-1': 'Frontend' }, projectAlias: {},
  })
  assert.equal(tree.tabs.length, 2)
  assert.equal(tree.tabs[0]!.pinned, true)
  assert.equal(tree.tabs[0]!.label, undefined)
  assert.equal(tree.tabs[0]!.id, '__default__')
  assert.equal(tree.tabs[1]!.label, 'Frontend')
})

test('deriveProjectTree: an unknown active tab falls back to the pinned tab', () => {
  const tree = deriveProjectTree(listState({}), [], new Map(), [], {
    expanded: [], activeTab: 'ghost',
    projectGroup: {}, groupIds: [], groupLabels: {}, projectAlias: {},
  })
  assert.equal(tree.activeTab, '__default__')
})

test('deriveProjectTree: the project alias overrides the directory basename', () => {
  layouts.clear()
  layouts.set('/repo', layout('/repo', [{ path: '/repo', branch: 'main', main: true }]))
  const tree = deriveProjectTree(listState({}), [workspace('ws-1', '/repo', [])], layouts, [], {
    expanded: [], activeTab: '__default__',
    projectGroup: {}, groupIds: [], groupLabels: {}, projectAlias: { '/repo': 'My Project' },
  })
  assert.equal(tree.projects[0]!.label, 'My Project')
})

test('deriveProjectTree: a single-registration worktree row is named by the workspace title', () => {
  layouts.clear()
  layouts.set('/repo', layout('/repo', [
    { path: '/repo', branch: 'main', main: true },
    { path: '/repo-worktrees/feat', branch: 'feat/auth', main: false },
  ]))
  layouts.set('/repo-worktrees/feat', layout('/repo', [
    { path: '/repo', branch: 'main', main: true },
    { path: '/repo-worktrees/feat', branch: 'feat/auth', main: false },
  ]))
  const tree = deriveProjectTree(listState({}), [
    workspace('ws-1', '/repo', []),
    workspace('ws-2', '/repo-worktrees/feat', [], 'Renamed Title'),
  ], layouts, [], {
    expanded: [], activeTab: '__default__',
    projectGroup: {}, groupIds: [], groupLabels: {}, projectAlias: {},
    // The workspace title is the row's name (worktree = workspace); a stale
    // alias no longer masks a rename.
    worktreeAlias: { '/repo-worktrees/feat': 'Custom Feature Worktree' },
  })
  const wt = tree.projects[0]!.worktrees.find(w => w.path === '/repo-worktrees/feat')
  assert.equal(wt?.label, 'Renamed Title')
})

test('deriveProjectTree: the alias still names a registration-less worktree row', () => {
  layouts.clear()
  layouts.set('/repo', layout('/repo', [
    { path: '/repo', branch: 'main', main: true },
    // No workspace lives under the linked worktree (created externally).
    { path: '/repo-worktrees/feat', branch: 'feat/auth', main: false },
  ]))
  const tree = deriveProjectTree(listState({}), [
    workspace('ws-1', '/repo', []),
  ], layouts, [], {
    expanded: [], activeTab: '__default__',
    projectGroup: {}, groupIds: [], groupLabels: {}, projectAlias: {},
    worktreeAlias: { '/repo-worktrees/feat': 'Custom Feature Worktree' },
  })
  const wt = tree.projects[0]!.worktrees.find(w => w.path === '/repo-worktrees/feat')
  assert.equal(wt?.label, 'Custom Feature Worktree')
})

test('deriveProjectTree: containsCurrent is true when the current session lives under the project', () => {
  layouts.clear()
  layouts.set('/repo', layout('/repo', [{ path: '/repo', branch: 'main', main: true }]))
  const list = listState({ 's1': summary('s1') }, 's1')
  const tree = deriveProjectTree(list, [workspace('ws-1', '/repo', ['s1'])], layouts, [], {
    expanded: [], activeTab: '__default__',
    projectGroup: {}, groupIds: [], groupLabels: {}, projectAlias: {},
  })
  assert.equal(tree.projects[0]!.containsCurrent, true)
})

/* ------------------------------------------------------------------------- *
 * deriveFlat
 * ------------------------------------------------------------------------- */

test('deriveFlat: every visible session is one row, newest first', () => {
  const list = listState({
    'old': summary('old', { updatedAt: 100 }),
    'new': summary('new', { updatedAt: 300 }),
    'mid': summary('mid', { updatedAt: 200 }),
  })
  const rows = deriveFlat(list, [])
  assert.deepEqual(rows.map(r => r.id), ['new', 'mid', 'old'])
})

test('deriveFlat: subagent, archived and non-current blank rows are excluded', () => {
  const list = listState({
    'a': summary('a'),
    'sa': summary('sa', { origin: 'subagent', parentId: 'a' as SessionId }),
    'arch': summary('arch'),
    'blank': summary('blank', { blank: true }),
  }, 'a')
  const rows = deriveFlat(list, ['arch'] as SessionId[])
  assert.deepEqual(rows.map(r => r.id), ['a'])
})

/* ------------------------------------------------------------------------- *
 * deriveSearchResults
 * ------------------------------------------------------------------------- */

test('deriveSearchResults: an empty query yields nothing', () => {
  const results = deriveSearchResults(listState({ 'a': summary('a') }), [], '  ', [], {
    items: [], hasMore: false,
  }, 10)
  assert.deepEqual(results.items, [])
  assert.equal(results.hasMore, false)
})

test('deriveSearchResults: local title matches lead, content-only matches keep the backend snippet', () => {
  const list = listState({ 'a': summary('a'), 'b': summary('b') })
  const results = deriveSearchResults(list, [workspace('ws-1', '/repo', ['a', 'b'])], 'a', [], {
    items: [{ sessionId: 'b' as SessionId, snippet: '…matched…' }], hasMore: false,
  }, 10)
  assert.deepEqual(results.items.map(i => i.id), ['a', 'b'])
  assert.equal(results.items[1]!.snippet, '…matched…')
})

test('deriveSearchResults: hasMore reflects the backend page or the local limit', () => {
  const list = listState({ 'a': summary('a'), 'b': summary('b') })
  const content = deriveSearchResults(list, [], 'a', [], { items: [], hasMore: true }, 10)
  assert.equal(content.hasMore, true)
  // "repo" (the workspace title) matches both rows locally; the limit of one
  // then reports hasMore for the overflow.
  const capped = deriveSearchResults(list, [workspace('ws-1', '/repo', ['a', 'b'])], 'e', [], {
    items: [], hasMore: false,
  }, 1)
  assert.equal(capped.items.length, 1)
  assert.equal(capped.hasMore, true)
})

/* ------------------------------------------------------------------------- *
 * relativeTime + workspaceLabel
 * ------------------------------------------------------------------------- */

test('relativeTime: bucket boundaries', () => {
  const now = 1_000_000_000_000
  assert.deepEqual(relativeTime(now, now), { unit: 'now', n: 0 })
  assert.deepEqual(relativeTime(now - 59_999, now), { unit: 'now', n: 0 })
  assert.deepEqual(relativeTime(now - 60_000, now), { unit: 'minutes', n: 1 })
  assert.deepEqual(relativeTime(now - 3_599_999, now), { unit: 'minutes', n: 59 })
  assert.deepEqual(relativeTime(now - 3_600_000, now), { unit: 'hours', n: 1 })
  assert.deepEqual(relativeTime(now - 86_400_000, now), { unit: 'days', n: 1 })
  assert.deepEqual(relativeTime(now - 30 * 86_400_000, now), { unit: 'months', n: 1 })
  assert.deepEqual(relativeTime(now - 365 * 86_400_000, now), { unit: 'years', n: 1 })
})

test('workspaceLabel: basename, trailing slash, empty and root cases', () => {
  assert.equal(workspaceLabel('/a/b/c'), 'c')
  assert.equal(workspaceLabel('/a/b/c/'), 'c')
  assert.equal(workspaceLabel('C:\\repo\\proj'), 'proj')
  assert.equal(workspaceLabel('/'), '/')
  assert.equal(workspaceLabel(undefined), UNGROUPED_LABEL)
  assert.equal(workspaceLabel(''), UNGROUPED_LABEL)
})

/* ------------------------------------------------------------------------- *
 * worktreeVisibleSessions — the row-click visibility contract
 * ------------------------------------------------------------------------- */

test('worktreeVisibleSessions: a folded worktree hides its sessions outright', () => {
  const sessions = [node('s1'), node('s2')]
  assert.deepEqual(worktreeVisibleSessions(sessions, false, false, 5), [])
  assert.deepEqual(worktreeVisibleSessions(sessions, false, true, 5), [])
})

test('worktreeVisibleSessions: an expanded worktree previews the limit until the run widens', () => {
  const sessions = [node('s1'), node('s2'), node('s3'), node('s4'), node('s5'), node('s6')]
  assert.deepEqual(worktreeVisibleSessions(sessions, true, false, 5).map(s => s.id), ['s1', 's2', 's3', 's4', 's5'])
  assert.deepEqual(worktreeVisibleSessions(sessions, true, true, 5).map(s => s.id), ['s1', 's2', 's3', 's4', 's5', 's6'])
})

test('worktreeVisibleSessions: a small run is fully visible when expanded', () => {
  const sessions = [node('s1'), node('s2')]
  assert.deepEqual(worktreeVisibleSessions(sessions, true, false, 5).map(s => s.id), ['s1', 's2'])
})

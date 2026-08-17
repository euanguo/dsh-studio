import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildSubagentTree,
  jobRowsFor,
  subagentAutoOpenDecision,
} from '../plugins/sidebar/src/client/subagent/subagent-model.ts'
import type { SessionListState } from '../plugins/sidebar/src/client/client-types.ts'

function list(input: Partial<SessionListState>): SessionListState {
  return {
    byId: input.byId ?? {},
    ...(input.current === undefined ? {} : { current: input.current }),
    ...(input.subagentsByParent === undefined
      ? {}
      : { subagentsByParent: input.subagentsByParent }),
    ...(input.jobsBySession === undefined ? {} : { jobsBySession: input.jobsBySession }),
  }
}

test('subagent tree groups children under their durable parent', () => {
  const snapshot = list({
    byId: {
      root: { displayTitle: 'Main', running: true },
      child1: { displayTitle: 'A', parentId: 'root', origin: 'subagent', running: true },
      child2: { displayTitle: 'B', parentId: 'root' },
      grandchild: { displayTitle: 'A-1', parentId: 'child1' },
      sibling: { displayTitle: 'Other' },
    },
  })
  const trees = buildSubagentTree(snapshot)
  assert.deepEqual(trees.map(node => node.session.id), ['root', 'sibling'])
  const root = trees[0]!
  assert.deepEqual(root.children.map(node => node.session.id), ['child1', 'child2'])
  assert.deepEqual(root.children[0]!.children.map(node => node.session.id), ['grandchild'])
})

test('subagent tree orphans a child whose parent is missing from the feed', () => {
  const trees = buildSubagentTree(list({
    byId: {
      child: { parentId: 'gone', origin: 'subagent' },
    },
  }))
  assert.deepEqual(trees.map(node => node.session.id), ['child'])
  assert.deepEqual(trees[0]!.children, [])
})

test('subagent auto-open fires for a new child of the current session only', () => {
  const prefs = { autoOpenSubagent: true, autoOpenJobs: false }
  const before = list({ current: 'root', byId: { root: {} } })
  const after = list({
    current: 'root',
    byId: {
      root: {},
      baby: { parentId: 'root', origin: 'subagent' },
    },
  })
  assert.equal(subagentAutoOpenDecision(before, after, prefs), 'subagent')
  // A child of ANOTHER session is not our concern.
  const otherParent = list({
    current: 'root',
    byId: { root: {}, baby: { parentId: 'elsewhere' } },
  })
  assert.equal(subagentAutoOpenDecision(before, otherParent, prefs), null)
  // The toggle gates it.
  assert.equal(subagentAutoOpenDecision(before, after, { ...prefs, autoOpenSubagent: false }), null)
  // No change → nothing.
  assert.equal(subagentAutoOpenDecision(after, after, prefs), null)
})

test('subagent auto-open fires for a new job of the current session only', () => {
  const prefs = { autoOpenSubagent: false, autoOpenJobs: true }
  const before = list({
    current: 'root',
    byId: { root: {} },
    jobsBySession: { root: [{ id: 'bash-1', kind: 'bash', label: 'x', status: 'running', startedAt: 1 }] },
  })
  const after = list({
    ...before,
    jobsBySession: {
      root: [
        { id: 'bash-1', kind: 'bash', label: 'x', status: 'running', startedAt: 1 },
        { id: 'subagent-2', kind: 'subagent', label: 'y', status: 'running', startedAt: 2 },
      ],
    },
  })
  assert.equal(subagentAutoOpenDecision(before, after, prefs), 'jobs')
  // Status flips are not new jobs.
  const flipped = list({
    ...after,
    jobsBySession: {
      root: [{ id: 'bash-1', kind: 'bash', label: 'x', status: 'completed', startedAt: 1 }],
    },
  })
  assert.equal(subagentAutoOpenDecision(before, flipped, prefs), null)
  assert.equal(subagentAutoOpenDecision(before, after, { ...prefs, autoOpenJobs: false }), null)
})

test('job rows sort newest-first and default to an empty set', () => {
  const rows = jobRowsFor({
    s: [
      { id: 'a', kind: 'bash', label: 'a', status: 'running', startedAt: 1 },
      { id: 'b', kind: 'bash', label: 'b', status: 'completed', startedAt: 3 },
    ],
  }, 's')
  assert.deepEqual(rows.map(job => job.id), ['b', 'a'])
  assert.deepEqual(jobRowsFor({}, 'nope'), [])
  assert.deepEqual(jobRowsFor(undefined, 'nope'), [])
})
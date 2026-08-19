import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  resolveSourceControlActions,
  type SourceControlActionInputs,
} from '../plugins/sidebar/src/client/source-control/source-control-actions.ts'

function inputs(overrides: Partial<SourceControlActionInputs> = {}): SourceControlActionInputs {
  return {
    hasChanges: false,
    hasUnresolvedConflicts: false,
    hasMessage: false,
    busy: false,
    upstream: {
      branch: 'main',
      upstream: 'origin/main',
      hasRemote: true,
      hasUpstream: true,
      ahead: 0,
      behind: 0,
      conflictOperation: null,
    },
    ...overrides,
  }
}

test('source-control actions: a staged draft makes Commit primary', () => {
  const state = resolveSourceControlActions(inputs({ hasChanges: true, hasMessage: true }))
  assert.deepEqual(state.primary, { kind: 'commit', disabled: false })
})

test('source-control actions: a missing draft explains why Commit is disabled', () => {
  const state = resolveSourceControlActions(inputs({ hasChanges: true }))
  assert.deepEqual(state.primary, {
    kind: 'commit',
    disabled: true,
    disabledReason: 'missing-message',
  })
})

test('source-control actions: a local-only branch publishes before it pushes', () => {
  const state = resolveSourceControlActions(inputs({
    upstream: {
      branch: 'feature',
      upstream: null,
      hasRemote: true,
      hasUpstream: false,
      ahead: 0,
      behind: 0,
      conflictOperation: null,
    },
  }))
  assert.deepEqual(state.primary, { kind: 'publish', disabled: false })
})

test('source-control actions: diverged upstream selects safe sync', () => {
  const state = resolveSourceControlActions(inputs({
    upstream: {
      branch: 'main',
      upstream: 'origin/main',
      hasRemote: true,
      hasUpstream: true,
      ahead: 2,
      behind: 3,
      conflictOperation: null,
    },
  }))
  assert.deepEqual(state.primary, { kind: 'sync', disabled: false })
})

test('source-control actions: active merge disables commit and exposes only matching abort', () => {
  const state = resolveSourceControlActions(inputs({
    hasChanges: true,
    hasMessage: true,
    upstream: {
      branch: 'main',
      upstream: 'origin/main',
      hasRemote: true,
      hasUpstream: true,
      ahead: 0,
      behind: 0,
      conflictOperation: 'merge',
    },
  }))
  assert.deepEqual(state.primary, {
    kind: 'commit',
    disabled: true,
    disabledReason: 'conflict',
  })
  assert.deepEqual(state.dropdown.at(-1), {
    kind: 'abort-merge',
    disabled: false,
    danger: true,
  })
  assert.equal(state.dropdown.some(action => action.kind === 'abort-rebase'), false)
})

test('source-control actions: busy state rejects duplicate dispatches', () => {
  const state = resolveSourceControlActions(inputs({ hasChanges: true, hasMessage: true, busy: true }))
  assert.deepEqual(state.primary, { kind: 'commit', disabled: true, disabledReason: 'busy' })
  assert.ok(state.dropdown.every(action => action.disabled))
})

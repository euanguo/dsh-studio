import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INITIAL_TERMINAL_ACTIVITY,
  transitionTerminalActivity,
} from '../plugins/shared/terminal/terminal-activity.ts'

test('detached output enters review with unread state', () => {
  assert.deepEqual(transitionTerminalActivity(INITIAL_TERMINAL_ACTIVITY, {
    type: 'output', attached: false,
  }), { state: 'review', unreadOutput: true })
})

test('input and reveal clear review, while errors remain attention', () => {
  const review = transitionTerminalActivity(INITIAL_TERMINAL_ACTIVITY, {
    type: 'output', attached: false,
  })
  assert.deepEqual(transitionTerminalActivity(review, { type: 'reveal' }), {
    state: 'running', unreadOutput: false,
  })
  assert.deepEqual(transitionTerminalActivity(review, { type: 'attention' }), {
    state: 'attention', unreadOutput: true,
  })
})

test('exit is terminal until reset', () => {
  const exited = transitionTerminalActivity(INITIAL_TERMINAL_ACTIVITY, { type: 'exit' })
  assert.deepEqual(exited, { state: 'exited', unreadOutput: false })
  assert.deepEqual(transitionTerminalActivity(exited, { type: 'reset' }), INITIAL_TERMINAL_ACTIVITY)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INITIAL_TERMINAL_SCROLL_INTENT,
  isTerminalScrollPinned,
  reduceTerminalScrollIntent,
  transitionTerminalScrollIntent,
} from '../plugins/shared/terminal-scroll-intent.ts'

test('user scrolling up pauses following and output becomes unseen', () => {
  const paused = transitionTerminalScrollIntent(INITIAL_TERMINAL_SCROLL_INTENT, {
    type: 'user-scroll', atBottom: false,
  })
  assert.equal(isTerminalScrollPinned(paused), false)
  assert.deepEqual(transitionTerminalScrollIntent(paused, { type: 'programmatic-output' }), {
    intent: 'paused', unseenOutput: true,
  })
})

test('programmatic output keeps a pinned terminal following', () => {
  assert.deepEqual(transitionTerminalScrollIntent(INITIAL_TERMINAL_SCROLL_INTENT, {
    type: 'programmatic-output',
  }), INITIAL_TERMINAL_SCROLL_INTENT)
})

test('returning to the bottom resumes following and clears unseen output', () => {
  assert.deepEqual(reduceTerminalScrollIntent([
    { type: 'user-scroll', atBottom: false },
    { type: 'programmatic-output' },
    { type: 'return-to-bottom' },
  ]), INITIAL_TERMINAL_SCROLL_INTENT)
})

test('reveal enters revealed state and reset restores defaults', () => {
  const revealed = transitionTerminalScrollIntent(INITIAL_TERMINAL_SCROLL_INTENT, { type: 'reveal' })
  assert.deepEqual(revealed, { intent: 'revealed', unseenOutput: false })
  assert.deepEqual(transitionTerminalScrollIntent(revealed, { type: 'reset' }), INITIAL_TERMINAL_SCROLL_INTENT)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTerminalModeReplayTracker } from '../plugins/capabilities/src/terminal-mode-replay.ts'

test('mode replay tracks bracketed paste and alternate screen state', () => {
  const tracker = createTerminalModeReplayTracker(20, 4)
  tracker.feed('\u001b[?2004h\u001b[?1049h\u001b[2J\u001b[Hdashboard')
  const preamble = tracker.buildPreamble()
  const screen = tracker.buildScreenReplay()
  assert.equal(preamble.includes('\u001b[?2004h'), true)
  assert.equal(screen.includes('\u001b[?1049h'), true)
  assert.equal(screen.includes('dashboard'), true)
  tracker.dispose()
})

test('mode replay reflects resized screen and cursor position in alternate screen', () => {
  const tracker = createTerminalModeReplayTracker(20, 4)
  tracker.feed('\u001b[?1049hone\r\ntwo')
  tracker.resize(40, 8)
  const screen = tracker.buildScreenReplay()
  assert.equal(screen.includes('\u001b[?1049h'), true)
  assert.equal(screen.includes('one'), true)
  assert.equal(screen.includes('two'), true)
  tracker.dispose()
})

test('mode replay returns empty live screen for normal buffer to preserve scrollback', () => {
  const tracker = createTerminalModeReplayTracker(20, 4)
  tracker.feed('normal shell prompt$ ')
  assert.equal(tracker.buildScreenReplay(), '')
  tracker.dispose()
})

test('mode replay emits kitty keyboard state', () => {
  const tracker = createTerminalModeReplayTracker(20, 4)
  tracker.feed('\u001b[>7u')
  assert.equal(tracker.buildPreamble().includes('\u001b[=7;1u'), true)
  tracker.dispose()
})

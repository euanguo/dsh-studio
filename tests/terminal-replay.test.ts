import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildTerminalReplayPayload } from '../plugins/capabilities/src/terminal/terminal-replay.ts'

test('terminal replay composes history, modes, then live screen', () => {
  const payload = buildTerminalReplayPayload({
    replayTranscript: 'history',
    modeReplay: {
      buildPreamble: () => '<mode>',
      buildScreenReplay: () => '<screen>',
    },
  })
  assert.equal(payload, 'history<mode><screen>')
})

test('terminal replay falls back to safe history without a mode tracker', () => {
  assert.equal(
    buildTerminalReplayPayload({ replayTranscript: 'visible', modeReplay: null }),
    'visible',
  )
})

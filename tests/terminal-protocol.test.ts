import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CAPABILITIES_TERMINAL_WS_PATH } from '../plugins/panel-controls/src/terminal/terminal-socket.ts'

test('desktop terminal uses the capabilities gateway endpoint', () => {
  assert.equal(CAPABILITIES_TERMINAL_WS_PATH, '/capabilities/ws/terminal')
})

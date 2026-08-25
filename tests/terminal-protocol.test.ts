import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CAPABILITIES_TERMINAL_WS_PATH } from '@dsh-studio/shared/terminal-socket'

test('desktop terminal uses the capabilities gateway endpoint', () => {
  assert.equal(CAPABILITIES_TERMINAL_WS_PATH, '/capabilities/ws/terminal')
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isStablePaneId, parsePaneKey } from '../plugins/shared/stable-pane-id.ts'
import {
  releaseTerminalInstance,
  terminalInstanceCount,
  touchTerminalInstance,
} from '../plugins/sidebar/src/client/runtimes/terminal-runtime.ts'

test('terminal runtime retains one stable pane identity per scoped tab', () => {
  const scope = {
    sessionId: `runtime-test-${Date.now()}`,
    cwd: '/tmp/runtime-test',
  }
  const first = touchTerminalInstance(scope, 'terminal:1')
  const second = touchTerminalInstance(scope, 'terminal:1')

  assert.equal(first, second)
  assert.equal(isStablePaneId(first.leafId), true)
  assert.equal(parsePaneKey(first.paneKey)?.leafId, first.leafId)
  assert.equal(terminalInstanceCount(scope), 1)

  releaseTerminalInstance(scope, 'terminal:1')
  assert.equal(terminalInstanceCount(scope), 0)
})

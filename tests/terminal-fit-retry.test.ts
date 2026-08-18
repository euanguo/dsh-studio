import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  armTerminalFitContinuationRetry,
  clearTerminalFitContinuationRetry,
} from '../plugins/shared/terminal-fit-retry.ts'

test('armTerminalFitContinuationRetry retries until true or exhausted', async () => {
  const target = {}
  let calls = 0
  await new Promise<void>(resolve => {
    armTerminalFitContinuationRetry(target, {
      retry: () => {
        calls += 1
        return calls >= 3
      },
      onExhausted: () => {
        assert.fail('should not exhaust before success')
      },
    })

    const interval = setInterval(() => {
      if (calls >= 3) {
        clearInterval(interval)
        clearTerminalFitContinuationRetry(target)
        resolve()
      }
    }, 10)
  })
  assert.ok(calls >= 3)
})

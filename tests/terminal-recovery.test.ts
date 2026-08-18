import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TerminalRecoveryCoordinator,
} from '../plugins/shared/terminal-recovery.ts'

test('TerminalRecoveryCoordinator completes when recover succeeds on first attempt', async () => {
  let calls = 0
  const coordinator = new TerminalRecoveryCoordinator<{ id: string }>({
    recover: async () => { calls += 1 },
    classifyError: () => 'retryable',
    onPermanentFailure: () => {},
  })

  await coordinator.ensure('term-1', { id: 'term-1' }, 1)
  assert.equal(calls, 1)
  assert.equal(coordinator.isPending('term-1'), false)
})

test('TerminalRecoveryCoordinator rejects on permanent failure without retrying', async () => {
  let permanentFailed = false
  const coordinator = new TerminalRecoveryCoordinator<{ id: string }>({
    recover: async () => { throw new Error('unrecoverable') },
    classifyError: () => 'permanent',
    onPermanentFailure: () => { permanentFailed = true },
  })

  await assert.rejects(
    coordinator.ensure('term-2', { id: 'term-2' }, 1),
    /unrecoverable/,
  )
  assert.equal(permanentFailed, true)
  assert.equal(coordinator.isPending('term-2'), false)
})

test('TerminalRecoveryCoordinator rejects previous completion when generation is replaced', async () => {
  let finishFirst: () => void = () => {}
  const firstBlocker = new Promise<void>(resolve => { finishFirst = resolve })

  const coordinator = new TerminalRecoveryCoordinator<{ id: string }>({
    recover: async () => { await firstBlocker },
    classifyError: () => 'retryable',
    onPermanentFailure: () => {},
  })

  const p1 = coordinator.ensure('term-3', { id: 'term-3' }, 1)
  // Generation 2 replaces generation 1:
  const p2 = coordinator.ensure('term-3', { id: 'term-3' }, 2)

  await assert.rejects(p1, /generation was replaced/)
  finishFirst()
  await p2
})
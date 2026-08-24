import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TerminalOutputBatcher,
  appendOutputChunk,
} from '../plugins/capabilities/src/terminal/terminal-batcher.ts'
import { TerminalOutputScheduler } from '../plugins/shared/terminal/terminal-output-scheduler.ts'

class StressTarget {
  writes: string[] = []
  write(data: string, callback?: () => void): void {
    this.writes.push(data)
    callback?.()
  }
}

test('terminal batcher stress: 50,000 rapid output appends and watermarks', () => {
  const sentFrames: any[] = []
  let paused = false
  const batcher = new TerminalOutputBatcher({
    batchIntervalMs: 5,
    batchSizeLimit: 64 * 1024,
    ackHighWatermark: 50_000,
    ackLowWatermark: 10_000,
    send: frame => sentFrames.push(frame),
    bufferedAmount: () => 0,
    pause: () => { paused = true },
    resume: () => { paused = false },
  })

  // 1. Send 50k small bursts
  for (let i = 0; i < 50_000; i += 1) {
    batcher.append(`chunk-${String(i)}\n`)
  }

  // Force batch flush
  batcher.flush()
  assert.ok(sentFrames.length > 0)
  assert.equal(paused, true) // Unacked bytes > ackHighWatermark

  // Acknowledge all emitted frames
  const lastFrame = sentFrames[sentFrames.length - 1]
  const ackOk = batcher.acknowledge({
    type: 'ack',
    epoch: lastFrame.epoch,
    sequence: lastFrame.sequence,
    bytes: lastFrame.bytes,
  })
  assert.equal(ackOk, true)
  assert.equal(paused, false)
  batcher.dispose()
})

test('terminal scheduler stress: high concurrency multi-terminal fairness', () => {
  const target1 = new StressTarget()
  const target2 = new StressTarget()
  const sched1 = new TerminalOutputScheduler(target1)
  const sched2 = new TerminalOutputScheduler(target2)

  // Enqueue alternating chunks
  for (let i = 0; i < 1_000; i += 1) {
    sched1.enqueue(`t1-${String(i)}\n`)
    sched2.enqueue(`t2-${String(i)}\n`)
  }

  while (sched1.queuedByteCount > 0 || sched2.queuedByteCount > 0) {
    sched1.drainNow()
    sched2.drainNow()
  }
  assert.ok(target1.writes.length > 0)
  assert.ok(target2.writes.length > 0)
  assert.equal(sched1.queuedByteCount, 0)
  assert.equal(sched2.queuedByteCount, 0)
  sched1.dispose()
  sched2.dispose()
})

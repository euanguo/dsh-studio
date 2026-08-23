import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  appendOutputChunk,
  consumeOutputBatch,
  shouldFlushOutputBatch,
  TerminalOutputBatcher,
} from '../plugins/capabilities/src/terminal-batcher.ts'

test('batch algorithms append chunks and track UTF-8 byte count', () => {
  const b1 = appendOutputChunk([], 0, 'hello')
  assert.deepEqual(b1.chunks, ['hello'])
  assert.equal(b1.byteLength, 5)

  const b2 = appendOutputChunk(b1.chunks, b1.byteLength, ' 世界')
  assert.deepEqual(b2.chunks, ['hello', ' 世界'])
  assert.equal(b2.byteLength, 5 + 7) // one space plus two 3-byte characters
  assert.equal(shouldFlushOutputBatch(b2.byteLength, 10), true)
  assert.equal(shouldFlushOutputBatch(b2.byteLength, 100), false)

  const consumed = consumeOutputBatch(b2.chunks, b2.byteLength)
  assert.equal(consumed.data, 'hello 世界')
  assert.equal(consumed.byteLength, 12)
})

test('TerminalOutputBatcher emits size-bounded frames and resumes after ACK', () => {
  const frames: Array<{ sequence: number; data: string; bytes: number; epoch: string }> = []
  let paused = false
  let bufferedAmount = 0
  const batcher = new TerminalOutputBatcher({
    batchIntervalMs: 50,
    batchSizeLimit: 20,
    bufferHighWatermark: 30,
    ackHighWatermark: 20,
    ackLowWatermark: 1,
    send: frame => frames.push(frame),
    bufferedAmount: () => bufferedAmount,
    pause: () => { paused = true },
    resume: () => { paused = false },
  })

  batcher.append('12345')
  assert.equal(frames.length, 0)
  batcher.append('12345678901234567890')
  assert.equal(frames.length, 1)
  assert.equal(frames[0]?.data, '1234512345678901234567890')
  assert.equal(frames[0]?.sequence, 1)
  assert.equal(frames[0]?.bytes, 25)

  // The frame crosses the ACK high watermark, so PTY flow pauses until the
  // renderer confirms that xterm has consumed it.
  assert.equal(paused, true)
  const frame = frames[0]!
  assert.equal(batcher.acknowledge({
    type: 'ack',
    epoch: frame.epoch,
    sequence: frame.sequence,
    bytes: frame.bytes,
  }), true)
  assert.equal(paused, false)
  batcher.dispose()
  assert.equal(bufferedAmount, 0)
})

test('TerminalOutputBatcher pauses on an output backlog and drains socket pressure', () => {
  const frames: string[] = []
  let paused = false
  let bufferedAmount = 100
  const batcher = new TerminalOutputBatcher({
    batchIntervalMs: 50,
    batchSizeLimit: 5,
    bufferHighWatermark: 4,
    bufferLowWatermark: 1,
    socketHighWatermark: 50,
    socketLowWatermark: 10,
    send: frame => frames.push(frame.data),
    bufferedAmount: () => bufferedAmount,
    pause: () => { paused = true },
    resume: () => { paused = false },
  })

  batcher.append('12345')
  assert.equal(paused, true)
  assert.deepEqual(frames, [])
  bufferedAmount = 0
  batcher.flush()
  assert.deepEqual(frames, ['12345'])
  assert.equal(paused, false)
  batcher.dispose()
})

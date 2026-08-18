import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  RECENT_PTY_OUTPUT_LIMIT,
  RecentPtyOutputBuffer,
} from '../plugins/shared/recent-pty-output-buffer.ts'

test('RecentPtyOutputBuffer retains chunks and limits to 64KB', () => {
  const buffer = new RecentPtyOutputBuffer()
  buffer.append('hello ')
  buffer.append('world')
  assert.equal(buffer.read(), 'hello world')

  // Append data exceeding limit
  const hugeChunk = 'x'.repeat(RECENT_PTY_OUTPUT_LIMIT + 100)
  buffer.append(hugeChunk)
  assert.equal(buffer.read().length, RECENT_PTY_OUTPUT_LIMIT)
})

test('RecentPtyOutputBuffer compacts and maintains head index correctly', () => {
  const buffer = new RecentPtyOutputBuffer()
  for (let i = 0; i < 2000; i += 1) {
    buffer.append(`data-${String(i)}-`)
  }
  const result = buffer.read()
  assert.ok(result.length <= RECENT_PTY_OUTPUT_LIMIT)
  assert.ok(result.endsWith('data-1999-'))
  buffer.compact()
  assert.equal(buffer.read(), result)
})

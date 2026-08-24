import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  captureTerminalScrollState,
  clampTerminalViewportY,
  isTerminalViewportAtBottom,
  readTerminalScrollBufferSnapshot,
  restoreTerminalScrollState,
  type TerminalScrollTarget,
} from '../plugins/shared/terminal/terminal-scroll-snapshot.ts'

test('reads valid terminal scroll buffer snapshot', () => {
  const terminal: TerminalScrollTarget = {
    buffer: { active: { type: 'normal', viewportY: 10, baseY: 20 } },
  }
  assert.deepEqual(readTerminalScrollBufferSnapshot(terminal), {
    bufferType: 'normal',
    viewportY: 10,
    baseY: 20,
  })
  assert.equal(isTerminalViewportAtBottom(terminal), false)
  assert.equal(clampTerminalViewportY(terminal, 15), 15)
  assert.equal(clampTerminalViewportY(terminal, 99), 20) // clamped to baseY
  assert.equal(clampTerminalViewportY(terminal, -5), 0)
})

test('detects at-bottom when viewport equals or exceeds baseY', () => {
  const terminal: TerminalScrollTarget = {
    buffer: { active: { type: 'normal', viewportY: 20, baseY: 20 } },
  }
  assert.equal(isTerminalViewportAtBottom(terminal), true)
  const captured = captureTerminalScrollState(terminal)
  assert.deepEqual(captured, {
    bufferType: 'normal',
    viewportY: 20,
    baseY: 20,
    wasAtBottom: true,
  })
})

test('restores pinned scroll position or bottom tail', () => {
  let scrolledToBottom = false
  let scrolledToLine = -1
  const terminal: TerminalScrollTarget = {
    buffer: { active: { type: 'normal', viewportY: 10, baseY: 30 } },
    scrollToBottom: () => { scrolledToBottom = true },
    scrollToLine: line => { scrolledToLine = line },
  }

  // Restore pinned line:
  restoreTerminalScrollState(terminal, {
    bufferType: 'normal',
    viewportY: 12,
    baseY: 20,
    wasAtBottom: false,
  })
  assert.equal(scrolledToLine, 12)
  assert.equal(scrolledToBottom, false)

  // Restore at-bottom:
  restoreTerminalScrollState(terminal, {
    bufferType: 'normal',
    viewportY: 20,
    baseY: 20,
    wasAtBottom: true,
  })
  assert.equal(scrolledToBottom, true)
})
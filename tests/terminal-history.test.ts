import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  capHistoryBytes,
  capHistoryLines,
  TerminalHistoryBuffer,
} from '../plugins/sidebar-host/src/terminal-history.ts'

test('capHistoryLines caps line count while preserving trailing newline', () => {
  assert.equal(capHistoryLines('a\nb\nc\n', 2), 'b\nc\n')
  assert.equal(capHistoryLines('a\nb\nc', 2), 'b\nc')
  assert.equal(capHistoryLines('a\n', 5), 'a\n')
  assert.equal(capHistoryLines('', 5), '')
})

test('capHistoryBytes cuts on ANSI escape boundary when available', () => {
  const text = 'prefix text \x1b[31mred text\x1b[0m suffix'
  // Cut roughly inside the prefix should snap to ESC:
  const capped = capHistoryBytes(text, 25)
  assert.equal(capped.startsWith('\x1b[31m'), true)
})

test('TerminalHistoryBuffer appends in chunks and lazily materializes bounded string', () => {
  const buffer = new TerminalHistoryBuffer({ maxBytes: 100, maxLines: 5 })
  assert.equal(buffer.isEmpty, true)
  buffer.append('line 1\n')
  buffer.append('line 2\n')
  buffer.append('line 3\n')
  assert.equal(buffer.isEmpty, false)
  assert.equal(buffer.toString(), 'line 1\nline 2\nline 3\n')

  // Multiple chunks past line cap:
  for (let i = 4; i <= 10; i += 1) buffer.append(`line ${String(i)}\n`)
  const result = buffer.toString()
  assert.equal(result.split('\n').filter(Boolean).length, 5)
  assert.equal(result.endsWith('line 10\n'), true)
})
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  sanitizeTerminalHistoryChunk,
  TerminalHistorySanitizer,
} from '../plugins/sidebar-host/src/terminal-history-sanitizer.ts'

test('sanitizer strips cursor/erase controls but preserves SGR styling', () => {
  const result = sanitizeTerminalHistoryChunk(
    '',
    '\u001b[2J\u001b[H\u001b[31mred\u001b[0m\u001b[K',
  )
  assert.equal(result.visibleText, '\u001b[31mred\u001b[0m')
})

test('sanitizer carries incomplete escape sequences across chunks', () => {
  const sanitizer = new TerminalHistorySanitizer()
  assert.equal(sanitizer.feed('hello\u001b[').visibleText, 'hello')
  assert.equal(sanitizer.pending, '\u001b[')
  assert.equal(sanitizer.feed('31mred').visibleText, '\u001b[31mred')
  assert.equal(sanitizer.pending, '')
})

test('sanitizer extracts OSC title and agent hook events', () => {
  const result = sanitizeTerminalHistoryChunk(
    '',
    '\u001b]2;build shell\u0007\u001b]633;SYNARA_AGENT_EVENT=Start\u0007running',
  )
  assert.deepEqual(result.titleSignals, ['build shell'])
  assert.deepEqual(result.hookEvents, ['Start'])
  assert.equal(result.visibleText, '\u001b]2;build shell\u0007running')
})

test('sanitizer preserves Unicode text while stripping mode controls', () => {
  const result = sanitizeTerminalHistoryChunk('', '\u001b[?1049h界🙂\u001b[?1049l')
  assert.equal(result.visibleText, '界🙂')
})

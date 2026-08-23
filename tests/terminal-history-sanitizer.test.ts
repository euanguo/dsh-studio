import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  sanitizeTerminalHistoryChunk,
  TerminalHistorySanitizer,
} from '../plugins/capabilities/src/terminal-history-sanitizer.ts'

test('sanitizer strips cursor/erase controls but preserves SGR styling', () => {
  const result = sanitizeTerminalHistoryChunk(
    '',
    '\u001b[2J\u001b[H\u001b[31mred\u001b[0m\u001b[K',
  )
  assert.equal(result.visibleText, '\u001b[31mred\u001b[0m')
  assert.equal(result.clearScreen, true)
})

test('sanitizer drops pre-clear text on erase-screen (ED 2)', () => {
  const result = sanitizeTerminalHistoryChunk('', 'before\x1b[2Jafter')
  assert.equal(result.clearScreen, true)
  assert.equal(result.visibleText, 'after')
})

test('sanitizer treats clear -x (ED 3) as a full erase', () => {
  const result = sanitizeTerminalHistoryChunk('', 'old\x1b[3J$ ')
  assert.equal(result.clearScreen, true)
  assert.equal(result.visibleText, '$ ')
})

test('sanitizer does not clear on partial erases or SGR styling', () => {
  const result = sanitizeTerminalHistoryChunk('', 'keep\x1b[K\x1b[1J\x1b[2m still')
  assert.equal(result.clearScreen, false)
  assert.equal(result.visibleText, 'keep\x1b[2m still')
})

test('sanitizer propagates an erase-screen split across chunks', () => {
  const sanitizer = new TerminalHistorySanitizer()
  assert.equal(sanitizer.feed('old output\x1b[2').visibleText, 'old output')
  const result = sanitizer.feed('Jfresh')
  assert.equal(result.clearScreen, true)
  assert.equal(result.visibleText, 'fresh')
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

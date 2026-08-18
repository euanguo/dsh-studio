import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DESKTOP_TERMINAL_SCROLLBACK_ROW_PRESETS,
  DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT,
  DESKTOP_TERMINAL_SCROLLBACK_ROWS_MAX,
  DESKTOP_TERMINAL_SCROLLBACK_ROWS_MIN,
  legacyTerminalScrollbackBytesToRows,
  normalizeDesktopTerminalScrollbackRows,
  normalizeDesktopTerminalSnapshotRows,
  TERMINAL_OUTPUT_BACKLOG_MIN_CAP_CHARS,
  terminalOutputBacklogCapChars,
} from '../plugins/shared/terminal-scrollback-policy.ts'

test('terminal scrollback policy exports desktop row defaults and presets', () => {
  assert.equal(DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT, 5_000)
  assert.equal(DESKTOP_TERMINAL_SCROLLBACK_ROWS_MIN, 1_000)
  assert.equal(DESKTOP_TERMINAL_SCROLLBACK_ROWS_MAX, 50_000)
  assert.deepEqual(DESKTOP_TERMINAL_SCROLLBACK_ROW_PRESETS, [5_000, 10_000, 25_000, 50_000])
})

test('terminal scrollback policy normalizes persisted desktop rows without string coercion', () => {
  assert.equal(normalizeDesktopTerminalScrollbackRows(undefined), 5_000)
  assert.equal(normalizeDesktopTerminalScrollbackRows('25000'), 5_000)
  assert.equal(normalizeDesktopTerminalScrollbackRows(Number.NaN), 5_000)
  assert.equal(normalizeDesktopTerminalScrollbackRows(500.9), 1_000)
  assert.equal(normalizeDesktopTerminalScrollbackRows(25_000.9), 25_000)
  assert.equal(normalizeDesktopTerminalScrollbackRows(100_000), 50_000)
})

test('terminal scrollback policy normalizes snapshot rows while preserving visible-screen-only zero', () => {
  assert.equal(normalizeDesktopTerminalSnapshotRows(undefined), undefined)
  assert.equal(normalizeDesktopTerminalSnapshotRows('0'), undefined)
  assert.equal(normalizeDesktopTerminalSnapshotRows(0), 0)
  assert.equal(normalizeDesktopTerminalSnapshotRows(-1), 0)
  assert.equal(normalizeDesktopTerminalSnapshotRows(25_000.9), 25_000)
  assert.equal(normalizeDesktopTerminalSnapshotRows(100_000), 50_000)
})

test('terminal scrollback policy scales output backlog cap with scrollback rows above 2 MB floor', () => {
  assert.equal(terminalOutputBacklogCapChars(undefined), TERMINAL_OUTPUT_BACKLOG_MIN_CAP_CHARS)
  assert.equal(terminalOutputBacklogCapChars(5_000), TERMINAL_OUTPUT_BACKLOG_MIN_CAP_CHARS)
  assert.equal(terminalOutputBacklogCapChars('garbage'), TERMINAL_OUTPUT_BACKLOG_MIN_CAP_CHARS)
  assert.equal(terminalOutputBacklogCapChars(25_000), 3_000_000)
  assert.equal(terminalOutputBacklogCapChars(50_000), 6_000_000)
  assert.equal(terminalOutputBacklogCapChars(1_000_000), 6_000_000)
})

test('terminal scrollback policy migrates legacy decimal MB buckets by intent', () => {
  assert.equal(legacyTerminalScrollbackBytesToRows(undefined), 5_000)
  assert.equal(legacyTerminalScrollbackBytesToRows(0), 5_000)
  assert.equal(legacyTerminalScrollbackBytesToRows(1_000_000), 1_000)
  assert.equal(legacyTerminalScrollbackBytesToRows(10_000_000), 5_000)
  assert.equal(legacyTerminalScrollbackBytesToRows(25_000_000), 10_000)
  assert.equal(legacyTerminalScrollbackBytesToRows(50_000_000), 25_000)
  assert.equal(legacyTerminalScrollbackBytesToRows(100_000_000), 50_000)
  assert.equal(legacyTerminalScrollbackBytesToRows(250_000_000), 50_000)
})
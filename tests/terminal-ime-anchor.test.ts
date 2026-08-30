import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeTerminalImeAnchor } from '../plugins/shared/terminal/terminal-ime-anchor.ts'

test('computes a viewport-relative cursor anchor', () => {
  assert.deepEqual(computeTerminalImeAnchor({
    cursor: { row: 3, col: 7 }, rows: 24, cols: 80,
  }), { row: 3, col: 7 })
})

test('uses a matching visible prompt marker and clamps malformed geometry', () => {
  assert.deepEqual(computeTerminalImeAnchor({
    cursor: { row: 99, col: -4 }, rows: 3, cols: 4,
    options: { promptVisibleRow: 2, promptColumn: 9 },
  }), { row: 2, col: 3 })
  assert.deepEqual(computeTerminalImeAnchor({
    cursor: { row: Number.NaN, col: Number.POSITIVE_INFINITY }, rows: 0, cols: -1,
  }), { row: 0, col: 0 })
})

test('ignores prompt metadata for another row', () => {
  assert.deepEqual(computeTerminalImeAnchor({
    cursor: { row: 2, col: 7 }, rows: 4, cols: 12,
    options: { promptVisibleRow: 1, promptColumn: 1 },
  }), { row: 2, col: 7 })
})

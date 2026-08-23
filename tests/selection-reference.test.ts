/**
 * Unit tests for the pure selection-reference helpers: path
 * middle-ellipsis and the chip label format (line:col spans).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  columnFromNode,
  formatSelectionLabel,
  middleEllipsisPath,
} from '../plugins/sidebar/src/client/selection/selection-reference.ts'

/* ── middleEllipsisPath ───────────────────────────────────────────────── */

test('middleEllipsisPath keeps short paths unchanged', () => {
  assert.equal(middleEllipsisPath('src/i18n.ts'), 'src/i18n.ts')
})

test('middleEllipsisPath collapses the middle segments', () => {
  const out = middleEllipsisPath('plugins/sidebar/src/client/selection/selection-reference.ts')
  assert.ok(out.length < 60, `expected compact label, got ${out}`)
  assert.ok(out.startsWith('plugins/'), out)
  assert.ok(out.includes('…'), out)
  assert.ok(out.endsWith('selection/selection-reference.ts') || out.endsWith('selection-reference.ts'), out)
})

test('middleEllipsisPath survives single-segment long names', () => {
  const long = 'a'.repeat(80)
  const out = middleEllipsisPath(long)
  assert.ok(out.length <= 42)
  assert.ok(out.includes('…'))
})

/* ── formatSelectionLabel ─────────────────────────────────────────────── */

test('formatSelectionLabel renders single line with column', () => {
  assert.equal(
    formatSelectionLabel({ path: 'src/i18n.ts', span: { startLine: 12, endLine: 12, startColumn: 5, endColumn: 20 } }),
    'src/i18n.ts:12:5-20',
  )
})

test('formatSelectionLabel renders multi-line span with columns', () => {
  assert.equal(
    formatSelectionLabel({ path: 'src/i18n.ts', span: { startLine: 12, endLine: 18, startColumn: 5, endColumn: 20 } }),
    'src/i18n.ts:12-18:5',
  )
})

test('formatSelectionLabel renders without columns', () => {
  assert.equal(
    formatSelectionLabel({ path: 'src/i18n.ts', span: { startLine: 12, endLine: 15 } }),
    'src/i18n.ts:12-15',
  )
  assert.equal(
    formatSelectionLabel({ path: 'src/i18n.ts', span: { startLine: 12, endLine: 12 } }),
    'src/i18n.ts:12',
  )
})

test('formatSelectionLabel middle-ellipsizes long paths', () => {
  const label = formatSelectionLabel({
    path: 'plugins/sidebar/src/client/selection/selection-reference.ts',
    span: { startLine: 3, endLine: 9, startColumn: 1, endColumn: 40 },
  })
  assert.ok(label.includes('…'), label)
  assert.ok(label.includes(':3-9:1'), label)
})

/* ── columnFromNode (DOM-gated) ───────────────────────────────────────── */

test('columnFromNode degrades to null without DOM', () => {
  // Under node:test there is no document; the helper must not throw.
  assert.equal(columnFromNode({} as Element, {} as Node, 0), null)
})

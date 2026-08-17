import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  fullTabDropIndex,
  parseTabDrag,
  reorderIndexAfterRemoval,
  serializeTabDrag,
  tabDropSideOf,
} from '../plugins/sidebar/src/client/tab-drag.ts'

const sidePayload = { kind: 'sidebar-tab' as const, tabId: 'browser:1', source: 'side' as const }
const bottomPayload = { kind: 'sidebar-tab' as const, tabId: 'file:/a', source: 'bottom' as const }

test('tab drag payload serializes and parses round-trip; garbage → null', () => {
  assert.deepEqual(parseTabDrag(serializeTabDrag(sidePayload)), sidePayload)
  assert.deepEqual(parseTabDrag(serializeTabDrag(bottomPayload)), bottomPayload)
  assert.equal(parseTabDrag(undefined), null)
  assert.equal(parseTabDrag('not json'), null)
  assert.equal(parseTabDrag('{"kind":"other"}'), null)
  assert.equal(parseTabDrag('{"kind":"sidebar-tab","tabId":5}'), null)
  assert.equal(parseTabDrag('{"kind":"sidebar-tab","tabId":"a","source":"elsewhere"}'), null)
})

test('tab drop side splits the chip at its midpoint', () => {
  assert.equal(tabDropSideOf(0, 100), 'before')
  assert.equal(tabDropSideOf(49, 100), 'before')
  assert.equal(tabDropSideOf(50, 100), 'after')
  assert.equal(tabDropSideOf(99, 100), 'after')
})

test('fullTabDropIndex maps visible strip drops back to the full tab array', () => {
  const hidden = new Set(['files', 'review'])
  const tabs = [
    { id: 'review', type: 'review' },
    { id: 'files', type: 'files' },
    { id: 'browser:1', type: 'browser' },
    { id: 'file:/a', type: 'file' },
    { id: 'side:1', type: 'side-chat' },
  ]
  // Visible order: browser:1, file:/a, side:1 (the pinned ones are hidden).
  assert.equal(fullTabDropIndex(tabs, hidden, 'browser:1', 'before'), 2)
  assert.equal(fullTabDropIndex(tabs, hidden, 'browser:1', 'after'), 3)
  assert.equal(fullTabDropIndex(tabs, hidden, 'side:1', 'after'), 5)
  // Unknown hover falls back to append.
  assert.equal(fullTabDropIndex(tabs, hidden, 'nope', 'before'), 5)
})

test('reorderIndexAfterRemoval shifts the target down when the mover precedes it', () => {
  // Moving index 0 before index 2: after removal the insert lands at 1.
  assert.equal(reorderIndexAfterRemoval(0, 2), 1)
  // Moving index 3 before index 1: target stays 1.
  assert.equal(reorderIndexAfterRemoval(3, 1), 1)
  // Same position → unchanged.
  assert.equal(reorderIndexAfterRemoval(2, 2), 2)
})
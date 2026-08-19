import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  reorderById,
  tabDropSideOf,
} from '../plugins/sidebar/src/client/tab-drag.ts'
import {
  parseTabDrag,
  serializeTabDrag,
} from '../plugins/sidebar/src/client/use-tab-strip-drag.ts'

const sidePayload = { kind: 'sidebar-tab' as const, tabId: 'browser:1', source: 'side' as const }
const bottomPayload = { kind: 'sidebar-tab' as const, tabId: 'file:/a', source: 'bottom' as const }
const centerPayload = { kind: 'sidebar-tab' as const, tabId: 'diff:/b', source: 'center' as const }

test('tab drag payload serializes and parses round-trip; garbage → null', () => {
  assert.deepEqual(parseTabDrag(serializeTabDrag(sidePayload)), sidePayload)
  assert.deepEqual(parseTabDrag(serializeTabDrag(bottomPayload)), bottomPayload)
  assert.deepEqual(parseTabDrag(serializeTabDrag(centerPayload)), centerPayload)
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

test('reorderById moves a terminal before the first conversation after a forward drag', () => {
  const tabs = [
    { id: 'conversation:one' },
    { id: 'conversation:two' },
    { id: 'conversation:three' },
    { id: 'terminal:1' },
  ]

  assert.deepEqual(
    reorderById(tabs, 'terminal:1', 'conversation:one', 'before').map(tab => tab.id),
    ['terminal:1', 'conversation:one', 'conversation:two', 'conversation:three'],
  )
})

test('reorderById correctly shifts elements before/after target IDs without index drift', () => {
  const items = [
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
    { id: 'd' },
  ]

  // Move 'a' after 'c' -> [b, c, a, d]
  assert.deepEqual(reorderById(items, 'a', 'c', 'after').map(i => i.id), ['b', 'c', 'a', 'd'])

  // Move 'a' before 'c' -> [b, a, c, d]
  assert.deepEqual(reorderById(items, 'a', 'c', 'before').map(i => i.id), ['b', 'a', 'c', 'd'])

  // Move 'd' before 'b' -> [a, d, b, c]
  assert.deepEqual(reorderById(items, 'd', 'b', 'before').map(i => i.id), ['a', 'd', 'b', 'c'])

  // Move 'd' after 'b' -> [a, b, d, c]
  assert.deepEqual(reorderById(items, 'd', 'b', 'after').map(i => i.id), ['a', 'b', 'd', 'c'])

  // Move to end (no targetId) -> [b, c, d, a]
  assert.deepEqual(reorderById(items, 'a', null).map(i => i.id), ['b', 'c', 'd', 'a'])

  // Same item -> unchanged
  assert.deepEqual(reorderById(items, 'b', 'b', 'after').map(i => i.id), ['a', 'b', 'c', 'd'])

  // Missing source -> unchanged
  assert.deepEqual(reorderById(items, 'x', 'b').map(i => i.id), ['a', 'b', 'c', 'd'])
})

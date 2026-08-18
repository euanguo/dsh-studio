import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isStablePaneId,
  isTerminalLeafId,
  makePaneKey,
  parseLegacyNumericPaneKey,
  parsePaneKey,
} from '../plugins/shared/stable-pane-id.ts'

const LEAF_ID = '11111111-1111-4111-8111-111111111111'

test('recognizes UUID leaf ids as stable pane ids', () => {
  assert.equal(isStablePaneId(LEAF_ID), true)
  assert.equal(isTerminalLeafId(LEAF_ID), true)
})

test('rejects legacy numeric pane ids and malformed UUIDs', () => {
  for (const value of ['1', 'pane:1', '11111111-1111-6111-8111-111111111111', '']) {
    assert.equal(isStablePaneId(value), false)
    assert.equal(isTerminalLeafId(value), false)
  }
})

test('builds and parses pane keys using the tab id and UUID leaf id', () => {
  const paneKey = makePaneKey('tab-1', LEAF_ID)
  assert.equal(paneKey, `tab-1:${LEAF_ID}`)
  assert.deepEqual(parsePaneKey(paneKey), {
    tabId: 'tab-1',
    leafId: LEAF_ID,
    stablePaneId: LEAF_ID,
  })
})

test('rejects ambiguous tab ids and non-UUID leaf ids when building keys', () => {
  assert.throws(() => makePaneKey('', LEAF_ID), /tabId/)
  assert.throws(() => makePaneKey('tab:1', LEAF_ID), /tabId/)
  assert.throws(() => makePaneKey('tab-1', '1'), /UUID/)
})

test('rejects ambiguous or legacy pane-key inputs when parsing', () => {
  assert.equal(parsePaneKey('tab-1:1'), null)
  assert.equal(parsePaneKey(`tab:1:${LEAF_ID}`), null)
  assert.equal(parsePaneKey(`:${LEAF_ID}`), null)
  assert.equal(parsePaneKey('tab-1:'), null)
})

test('parses legacy numeric pane keys only for migration aliases', () => {
  assert.deepEqual(parseLegacyNumericPaneKey(' tab-1:12 '), {
    tabId: 'tab-1',
    numericPaneId: '12',
    paneKey: 'tab-1:12',
  })
  assert.equal(parseLegacyNumericPaneKey(`tab-1:${LEAF_ID}`), null)
  assert.equal(parseLegacyNumericPaneKey('tab:1:12'), null)
})
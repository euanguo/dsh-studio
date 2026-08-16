/**
 * Unit tests for the unified keymap module
 * (plugins/sidebar/src/client/kit/keymap.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  binding,
  bindingToString,
  eventMatchesBinding,
  parseBindingString,
} from '../plugins/sidebar/src/client/kit/keymap.ts'

function event(partial: {
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  key: string
}): KeyboardEvent {
  return {
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...partial,
  } as KeyboardEvent
}

test('bindingToString formats canonical display strings', () => {
  assert.equal(bindingToString(binding({ mod: true, shift: true, key: 'v' })), 'Mod+Shift+V')
  assert.equal(bindingToString(binding({ ctrl: true, shift: true, key: 'g' })), 'Ctrl+Shift+G')
  assert.equal(bindingToString(binding({ shift: true, key: 'F7' })), 'Shift+F7')
  assert.equal(bindingToString(binding({ mod: true, key: 's' })), 'Mod+S')
  assert.equal(bindingToString(binding({ key: 'Escape' })), 'Escape')
})

test('parseBindingString round-trips and is case-insensitive on modifiers', () => {
  const roundTrip = 'Mod+Shift+V'
  const parsed = parseBindingString(roundTrip)
  assert.deepEqual(parsed, { mod: true, ctrl: false, shift: true, alt: false, key: 'v' })
  assert.equal(bindingToString(parsed!), roundTrip)
  assert.deepEqual(parseBindingString('ctrl+SHIFT+G'), { mod: false, ctrl: true, shift: true, alt: false, key: 'g' })
  assert.deepEqual(parseBindingString('cmd+option+s'), { mod: true, ctrl: false, shift: false, alt: true, key: 's' })
  assert.deepEqual(parseBindingString('Escape'), { mod: false, ctrl: false, shift: false, alt: false, key: 'Escape' })
})

test('parseBindingString rejects unknown modifiers and empty keys', () => {
  assert.equal(parseBindingString('Hyper+S'), null)
  assert.equal(parseBindingString('Mod+'), null)
  assert.equal(parseBindingString(''), null)
  // Empty segments are tolerated (stray '+' is filtered before parsing).
  assert.deepEqual(parseBindingString('Mod++S'), { mod: true, ctrl: false, shift: false, alt: false, key: 's' })
})

test('mod bindings match Meta or Ctrl, and nothing else', () => {
  const bindingValue = binding({ mod: true, key: 's' })
  assert.equal(eventMatchesBinding(bindingValue, event({ metaKey: true, key: 's' })), true)
  assert.equal(eventMatchesBinding(bindingValue, event({ ctrlKey: true, key: 's' })), true)
  assert.equal(eventMatchesBinding(bindingValue, event({ key: 's' })), false)
  assert.equal(eventMatchesBinding(bindingValue, event({ metaKey: true, shiftKey: true, key: 'S' })), false)
  assert.equal(eventMatchesBinding(bindingValue, event({ metaKey: true, key: 'p' })), false)
})

test('ctrl bindings match a held Control key, with or without Meta', () => {
  const bindingValue = binding({ ctrl: true, shift: true, key: 'g' })
  assert.equal(eventMatchesBinding(bindingValue, event({ ctrlKey: true, shiftKey: true, key: 'G' })), true)
  assert.equal(eventMatchesBinding(bindingValue, event({ ctrlKey: true, metaKey: true, shiftKey: true, key: 'G' })), true)
  assert.equal(eventMatchesBinding(bindingValue, event({ metaKey: true, shiftKey: true, key: 'G' })), false)
  assert.equal(eventMatchesBinding(bindingValue, event({ ctrlKey: true, key: 'G' })), false)
})

test('plain bindings never match while a primary modifier is held', () => {
  const escape = binding({ key: 'Escape' })
  assert.equal(eventMatchesBinding(escape, event({ key: 'Escape' })), true)
  assert.equal(eventMatchesBinding(escape, event({ ctrlKey: true, key: 'Escape' })), false)
  assert.equal(eventMatchesBinding(escape, event({ metaKey: true, key: 'Escape' })), false)
  assert.equal(eventMatchesBinding(escape, event({ shiftKey: true, key: 'Escape' })), false)
})

test('F7 vs Shift+F7 are distinct bindings', () => {
  const next = binding({ shift: true, key: 'F7' })
  const prev = binding({ key: 'F7' })
  assert.equal(eventMatchesBinding(prev, event({ key: 'F7' })), true)
  assert.equal(eventMatchesBinding(prev, event({ shiftKey: true, key: 'F7' })), false)
  assert.equal(eventMatchesBinding(next, event({ shiftKey: true, key: 'F7' })), true)
  assert.equal(eventMatchesBinding(next, event({ key: 'F7' })), false)
})

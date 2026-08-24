/**
 * Unit tests for the ported runtime primitives (plugins/shared/runtime.ts)
 * and the middle-truncation pure functions (plugins/shared/middle-truncate-text.ts,
 * plugins/shared/filename-display.ts).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GenerationGate,
  RevisionedStore,
  ScopedRuntimeRegistry,
  SubscriptionScope,
} from '../plugins/shared/runtime/runtime.ts'
import { splitFilenameDisplayParts } from '../plugins/shared/filename-display.ts'
import {
  middleTruncateFilename,
  middleTruncateText,
} from '../plugins/shared/middle-truncate-text.ts'

/* ---------- RevisionedStore ---------- */

test('RevisionedStore: snapshot/subscribe/revision lifecycle', () => {
  const store = new RevisionedStore<{ n: number }>({ n: 1 })
  assert.deepEqual(store.getSnapshot(), { n: 1 })
  assert.equal(store.getRevision(), 0)

  const seen: number[] = []
  const unsubscribe = store.subscribe(() => { seen.push(store.getSnapshot().n) })
  store.setState({ n: 2 })
  assert.deepEqual(seen, [2])
  assert.equal(store.getRevision(), 1)

  unsubscribe()
  store.setState({ n: 3 })
  assert.deepEqual(seen, [2], 'unsubscribed listener must not fire')
})

test('RevisionedStore: functional updater and no-op writes', () => {
  const store = new RevisionedStore(0)
  store.setState(current => current + 1)
  assert.equal(store.getSnapshot(), 1)
  const revision = store.getRevision()
  store.setState(1) // same value — no revision bump, no notify
  assert.equal(store.getRevision(), revision)
})

test('RevisionedStore: disposed store stays readable and never notifies', () => {
  const store = new RevisionedStore('x')
  store.dispose()
  assert.equal(store.getSnapshot(), 'x')
  assert.equal(store.subscribe(() => {})(), undefined) // no throw
  store.setState('y') // no throw
  assert.equal(store.getSnapshot(), 'x')
})

/* ---------- GenerationGate ---------- */

test('GenerationGate: monotonic generations', () => {
  const gate = new GenerationGate()
  const first = gate.current()
  assert.equal(gate.isCurrent(first), true)
  const second = gate.next()
  assert.equal(gate.isCurrent(first), false)
  assert.equal(gate.isCurrent(second), true)
  assert.throws(() => gate.assertCurrent(first), /Stale generation/)
  gate.assertCurrent(second) // no throw
})

/* ---------- SubscriptionScope ---------- */

test('SubscriptionScope: cleanups run once, in reverse order', () => {
  const order: string[] = []
  const scope = new SubscriptionScope()
  scope.add(() => { order.push('a') })
  scope.add(() => { order.push('b') })
  scope.dispose()
  assert.deepEqual(order, ['b', 'a'])
  scope.dispose() // second dispose is a no-op
  assert.deepEqual(order, ['b', 'a'])
})

test('SubscriptionScope: addSubscription wires an external store', () => {
  const store = new RevisionedStore(0)
  const scope = new SubscriptionScope()
  let notified = 0
  scope.addSubscription(store, () => { notified += 1 })
  store.setState(1)
  assert.equal(notified, 1)
  scope.dispose()
  store.setState(2)
  assert.equal(notified, 1)
})

/* ---------- ScopedRuntimeRegistry ---------- */

test('ScopedRuntimeRegistry: getOrCreate returns the retained instance', () => {
  const registry = new ScopedRuntimeRegistry<string>({ maxEntries: 2 })
  const first = registry.getOrCreate('a', () => 'instance-a')
  const second = registry.getOrCreate('a', () => 'instance-a2')
  assert.equal(first, second, 'hit must not re-create')
  assert.equal(registry.size(), 1)
})

test('ScopedRuntimeRegistry: LRU eviction disposes the oldest entry', () => {
  const disposed: string[] = []
  const registry = new ScopedRuntimeRegistry<{ id: string }>({
    maxEntries: 2,
    dispose: value => { disposed.push(value.id) },
  })
  registry.set('a', { id: 'a' })
  registry.set('b', { id: 'b' })
  registry.touch('a') // 'b' is now the oldest
  registry.set('c', { id: 'c' }) // evicts 'b'
  assert.deepEqual(disposed, ['b'])
  assert.equal(registry.size(), 2)
  assert.equal(registry.get('a')?.id, 'a')
  assert.equal(registry.get('c')?.id, 'c')
})

test('ScopedRuntimeRegistry: isActive entries are never evicted', () => {
  const disposed: string[] = []
  const registry = new ScopedRuntimeRegistry<{ id: string; active: boolean }>({
    maxEntries: 2,
    isActive: value => value.active,
    dispose: value => { disposed.push(value.id) },
  })
  registry.set('hot', { id: 'hot', active: true })
  registry.set('cold-1', { id: 'cold-1', active: false })
  registry.set('cold-2', { id: 'cold-2', active: false })
  // 'cold-1' (oldest evictable) goes; 'hot' stays.
  assert.deepEqual(disposed, ['cold-1'])
  assert.equal(registry.get('hot')?.id, 'hot')
  assert.equal(registry.size(), 2)
})

test('ScopedRuntimeRegistry: delete and clear run dispose', () => {
  const disposed: string[] = []
  const registry = new ScopedRuntimeRegistry<{ id: string }>({
    maxEntries: 8,
    dispose: value => { disposed.push(value.id) },
  })
  registry.set('a', { id: 'a' })
  registry.set('b', { id: 'b' })
  assert.equal(registry.delete('a'), true)
  assert.equal(registry.delete('a'), false)
  registry.clear()
  assert.deepEqual(disposed, ['a', 'b'])
  assert.equal(registry.size(), 0)
})

/* ---------- Middle truncation ---------- */

function fakeMeasure(): (text: string) => number {
  // Each character (incl. ellipsis) costs 1px; used to assert truncation shape.
  return (text: string) => text.length
}

test('middleTruncateText: short text stays intact', () => {
  assert.equal(middleTruncateText('hello.ts', 100, fakeMeasure()), 'hello.ts')
})

test('middleTruncateText: long text becomes head…tail', () => {
  const result = middleTruncateText('abcdefghijklmnop', 8, fakeMeasure())
  assert.ok(result.length <= 8, `result "${result}" must fit max width`)
  assert.ok(result.includes('…'))
  assert.equal(result[0], 'a', 'keeps the head')
  assert.equal(result[result.length - 1], 'p', 'keeps the tail')
})

test('middleTruncateText: empty or zero width returns immediately', () => {
  assert.equal(middleTruncateText('', 100, fakeMeasure()), '')
  assert.equal(middleTruncateText('abc', 0, fakeMeasure()), 'abc')
})

test('middleTruncateFilename: extension is prefer-kept', () => {
  const result = middleTruncateFilename('very-long-file-name.ts', 12, fakeMeasure(), '.ts')
  assert.ok(result.endsWith('.ts'), `extension kept: ${result}`)
  assert.ok(result.includes('…'))
  assert.ok(result.length <= 12)
})

test('middleTruncateFilename: extension-only case falls back to plain truncate', () => {
  // `.ts` is 3px and the budget is 3px — the extension cannot fit alongside
  // an ellipsis, so the generic middle truncate runs and keeps head…tail.
  const result = middleTruncateFilename('abc.ts', 3, fakeMeasure(), '.ts')
  assert.equal(result, 'a…s')
})

test('splitFilenameDisplayParts: real extensions are kept, dotfiles are not', () => {
  assert.deepEqual(splitFilenameDisplayParts('main.ts'), { base: 'main', extension: '.ts' })
  assert.deepEqual(splitFilenameDisplayParts('.gitignore'), { base: '.gitignore', extension: '' })
  assert.deepEqual(splitFilenameDisplayParts('trailing.'), { base: 'trailing.', extension: '' })
  assert.deepEqual(splitFilenameDisplayParts('noext'), { base: 'noext', extension: '' })
  assert.deepEqual(splitFilenameDisplayParts('weird.name.with.space .ts'), {
    base: 'weird.name.with.space ',
    extension: '.ts',
  })
  assert.deepEqual(splitFilenameDisplayParts('a very long suffix.ts'), {
    base: 'a very long suffix',
    extension: '.ts',
  })
})

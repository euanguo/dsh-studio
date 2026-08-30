import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  GenerationGate,
  RevisionedStore,
  ScopedRuntimeRegistry,
  SubscriptionScope,
} from '../plugins/shared/runtime/runtime.ts'

test('RevisionedStore manages snapshots, revisions, and cleanups', () => {
  const store = new RevisionedStore({ count: 0 })
  assert.deepEqual(store.getSnapshot(), { count: 0 })
  assert.equal(store.getRevision(), 0)

  let called = 0
  const unsubscribe = store.subscribe(() => { called += 1 })
  store.setState({ count: 1 })
  assert.equal(called, 1)
  assert.equal(store.getRevision(), 1)
  assert.deepEqual(store.getSnapshot(), { count: 1 })

  // Same identity produces no revision bump or notify.
  store.setState(current => current)
  assert.equal(called, 1)
  assert.equal(store.getRevision(), 1)

  unsubscribe()
  store.setState({ count: 2 })
  assert.equal(called, 1)

  // Disposal freezes the store and does not throw on getSnapshot.
  store.dispose()
  assert.deepEqual(store.getSnapshot(), { count: 2 })
  store.setState({ count: 3 })
  assert.deepEqual(store.getSnapshot(), { count: 2 })
})

test('GenerationGate tracks incremental generations and detects staleness', () => {
  const gate = new GenerationGate()
  assert.equal(gate.current(), 0)
  const g1 = gate.next()
  assert.equal(g1, 1)
  assert.equal(gate.isCurrent(g1), true)
  assert.equal(gate.isCurrent(0), false)
  gate.assertCurrent(g1)
  assert.throws(() => { gate.assertCurrent(0) }, /Stale generation/)
})

test('SubscriptionScope manages and reverses cleanup execution', () => {
  const scope = new SubscriptionScope()
  const calls: number[] = []
  scope.add(() => { calls.push(1) })
  scope.add(() => { calls.push(2) })
  scope.dispose()
  assert.deepEqual(calls, [2, 1])
  assert.throws(() => { scope.add(() => {}) }, /disposed/)
})

test('ScopedRuntimeRegistry evicts LRU inactive entries above maxEntries', () => {
  const disposed: string[] = []
  const registry = new ScopedRuntimeRegistry<number>({
    maxEntries: 2,
    dispose: (_value, key) => { disposed.push(key) },
    isActive: val => val === 99, // 99 is pinned active
  })
  registry.set('a', 1)
  registry.set('b', 2)
  registry.touch('a') // a is now newer than b
  registry.set('c', 3) // b should be evicted

  assert.equal(registry.has('b'), false)
  assert.equal(registry.has('a'), true)
  assert.equal(registry.has('c'), true)
  assert.deepEqual(disposed, ['b'])

  // Active entries are never evicted.
  registry.set('pinned', 99)
  registry.set('d', 4)
  assert.equal(registry.has('pinned'), true)
})
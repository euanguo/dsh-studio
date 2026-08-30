import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DesktopBridge } from '@dsh-studio/shared/desktop-contracts'
import type { MarketplaceCommand, MarketplaceSnapshot } from '../plugins/plugin-marketplace/src/protocol.ts'
import {
  createMarketplaceStore,
  runMarketplaceCommand,
  refreshMarketplace,
  subscribeMarketplaceHost,
} from '../plugins/plugin-marketplace/src/client/store.ts'

// Behavior regression for the leaf-3.3 baseline (`9efaadf`): the client
// marketplace store keeps its monotonic request stamp and host-push ordering
// guarantees. An older asynchronous push re-pull must never overwrite a
// newer push, pushes must not disturb requestId/busy, and superseded
// dispatch responses must not clobber newer snapshots or surface stale
// errors. The implementation is intentionally untouched; these tests pin it.

const SNAPSHOT_A = { error: null, revisionLabel: 'a' }
const SNAPSHOT_B = { error: null, revisionLabel: 'b' }
const SNAPSHOT_C = { error: null, revisionLabel: 'c' }

function asSnapshot(value: object): MarketplaceSnapshot {
  return value as unknown as MarketplaceSnapshot
}

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(innerResolve => { resolve = innerResolve })
  return { promise, resolve }
}

interface PushBridge {
  bridge: DesktopBridge
  /** Simulate the host emitting `desktop:plugin-marketplace-changed`. */
  emit(): void
}

function pushBridge(
  getSnapshotResults: Array<Promise<unknown>>,
): PushBridge {
  const listeners: Array<() => void> = []
  const bridge = {
    pluginMarketplace: {
      async dispatch(_command: MarketplaceCommand): Promise<MarketplaceSnapshot> {
        throw new Error('dispatch not expected in this test')
      },
      async getSnapshot(): Promise<unknown> {
        return getSnapshotResults.shift()
      },
      onSnapshotChanged(listener: () => void): () => void {
        listeners.push(listener)
        return () => {}
      },
    },
  } as unknown as DesktopBridge
  return {
    bridge,
    emit: () => { for (const listener of [...listeners]) listener() },
  }
}

test('a stale async push re-pull cannot overwrite a newer push (monotonic token)', async () => {
  const stalePull = deferred<unknown>()
  const freshPull = deferred<unknown>()
  const hook = pushBridge([stalePull.promise, freshPull.promise])
  const store = createMarketplaceStore()
  const unsubscribe = subscribeMarketplaceHost(hook.bridge, store)
  try {
    // Two pushes arrive back-to-back; their re-pulls are both in flight.
    hook.emit()
    hook.emit()

    // The NEWER pull settles first.
    freshPull.resolve(asSnapshot(SNAPSHOT_B))
    await new Promise(resolve => { setImmediate(resolve) })
    assert.equal(store.getState().snapshot, asSnapshot(SNAPSHOT_B))

    // The OLDER pull settles afterwards and must be dropped.
    stalePull.resolve(asSnapshot(SNAPSHOT_A))
    await new Promise(resolve => { setImmediate(resolve) })
    assert.equal(store.getState().snapshot, asSnapshot(SNAPSHOT_B))
  } finally {
    unsubscribe()
  }
})

test('an unsubscribe stops push re-pulls entirely', async () => {
  const settled = Promise.resolve(asSnapshot(SNAPSHOT_A))
  const hook = pushBridge([settled])
  const store = createMarketplaceStore()
  const unsubscribe = subscribeMarketplaceHost(hook.bridge, store)
  unsubscribe()
  hook.emit()
  await new Promise(resolve => { setImmediate(resolve) })
  assert.equal(store.getState().snapshot, null)
})

test('acceptPush replaces the snapshot without touching requestId or busy', () => {
  const store = createMarketplaceStore()
  store.setState({ requestId: 7, busy: true })
  store.getState().acceptPush(asSnapshot(SNAPSHOT_A))
  const state = store.getState()
  assert.equal(state.snapshot, asSnapshot(SNAPSHOT_A))
  assert.equal(state.requestId, 7)
  assert.equal(state.busy, true)
})

test('accept applies only the latest requestId response', () => {
  const store = createMarketplaceStore()
  store.setState({ requestId: 5 })
  store.getState().accept(4, asSnapshot(SNAPSHOT_A))
  assert.equal(store.getState().snapshot, null, 'stale accept must be ignored')
  store.getState().accept(5, asSnapshot(SNAPSHOT_B))
  assert.equal(store.getState().snapshot, asSnapshot(SNAPSHOT_B))
})

test('a superseded dispatch response neither clobbers the snapshot nor surfaces its error', async () => {
  const slowFirst = deferred<MarketplaceSnapshot>()
  const fastSecond = deferred<MarketplaceSnapshot>()
  let calls = 0
  const bridge = {
    pluginMarketplace: {
      dispatch: async (_command: MarketplaceCommand): Promise<MarketplaceSnapshot> => {
        calls += 1
        return calls === 1 ? slowFirst.promise : fastSecond.promise
      },
      async getSnapshot(): Promise<unknown> { throw new Error('not expected') },
      onSnapshotChanged(): () => void { return () => {} },
    },
  } as unknown as DesktopBridge
  const store = createMarketplaceStore()

  const first = runMarketplaceCommand(bridge, store, { type: 'refresh' })
  const second = runMarketplaceCommand(bridge, store, { type: 'refresh' })

  // The second command wins the race.
  fastSecond.resolve(asSnapshot(SNAPSHOT_C))
  const secondOutcome = await second
  assert.equal(secondOutcome.snapshot, asSnapshot(SNAPSHOT_C))
  assert.equal(store.getState().snapshot, asSnapshot(SNAPSHOT_C))
  assert.equal(store.getState().busy, false)

  // The stale response then lands and must change nothing user-visible.
  slowFirst.resolve(asSnapshot(SNAPSHOT_A))
  const firstOutcome = await first
  assert.equal(firstOutcome.rejected, null)
  assert.equal(firstOutcome.snapshot, asSnapshot(SNAPSHOT_A), 'outcome reports what happened')
  assert.equal(store.getState().snapshot, asSnapshot(SNAPSHOT_C))
  assert.equal(store.getState().localError, null)
})

test('a busy rejection surfaces through localError and is cleared by the next command', async () => {
  const bridge = {
    pluginMarketplace: {
      dispatch: async (_command: MarketplaceCommand): Promise<MarketplaceSnapshot> => {
        throw new Error('the marketplace is busy processing another operation')
      },
      async getSnapshot(): Promise<unknown> { return asSnapshot(SNAPSHOT_A) },
      onSnapshotChanged(): () => void { return () => {} },
    },
  } as unknown as DesktopBridge
  const store = createMarketplaceStore()

  const outcome = await runMarketplaceCommand(bridge, store, { type: 'apply' })
  assert.equal(outcome.snapshot, null)
  assert.equal(outcome.rejected?.kind, 'busy')
  assert.match(outcome.rejected?.message ?? '', /marketplace is busy/)
  assert.match(store.getState().localError ?? '', /marketplace is busy/)
  assert.equal(store.getState().busy, false)

  // The next command start clears the retained local error up front.
  ;(bridge.pluginMarketplace as { dispatch(cmd: MarketplaceCommand): Promise<MarketplaceSnapshot> }).dispatch
    = async (): Promise<MarketplaceSnapshot> => asSnapshot(SNAPSHOT_B)
  const recovered = await runMarketplaceCommand(bridge, store, { type: 'refresh' })
  assert.equal(recovered.rejected, null)
  assert.equal(recovered.snapshot, asSnapshot(SNAPSHOT_B))
  assert.equal(store.getState().localError, null)
})

test('refreshMarketplace pulls the initial snapshot, dispatches refresh, and guards staleness', async () => {
  const initialPull = deferred<unknown>()
  const refreshDispatch = deferred<unknown>()
  const queue: Array<Promise<unknown>> = [initialPull.promise, refreshDispatch.promise]
  const bridge = {
    pluginMarketplace: {
      dispatch: async (_command: MarketplaceCommand): Promise<unknown> => {
        assert.deepEqual(_command, { type: 'refresh' })
        return queue.shift()
      },
      getSnapshot: async (): Promise<unknown> => queue.shift(),
      onSnapshotChanged(): () => void { return () => {} },
    },
  } as unknown as DesktopBridge
  const store = createMarketplaceStore()
  const running = refreshMarketplace(bridge, store)

  // A push lands between the pull and the refresh response; the guarded
  // refresh result still supersedes because it owns the latest requestId.
  refreshDispatch.resolve(asSnapshot(SNAPSHOT_C))
  initialPull.resolve(asSnapshot(SNAPSHOT_A))
  await running
  assert.equal(store.getState().snapshot, asSnapshot(SNAPSHOT_C))
  assert.equal(store.getState().busy, false)
  assert.equal(store.getState().localError, null)
})

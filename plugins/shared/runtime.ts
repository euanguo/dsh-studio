/**
 * Runtime primitives ported from the reference project's `@synara/client-runtime`
 * (packages/client-runtime/src/index.ts): RevisionedStore / GenerationGate /
 * SubscriptionScope / ScopedRuntimeRegistry / ResourceState.
 *
 * These are the building blocks of the "retained runtime + external store"
 * cache layer: data caches live in module-level registries that survive
 * component unmounts (only LRU eviction / explicit dispose releases them),
 * and views subscribe through `useSyncExternalStore` snapshots.
 *
 * Porting notes (differences from the reference):
 * - No `transport.ts` re-export (plugin has its own wire layer).
 * - Style follows the Oh-DSH shared packages (2-space, single quotes, no
 *   semicolons, explicit `.ts` import extensions).
 */

export type Unsubscribe = () => void

export type ExternalStore<Snapshot> = Readonly<{
  getSnapshot: () => Snapshot
  subscribe: (listener: () => void) => Unsubscribe
}>

export type StateUpdater<State> = State | ((current: State) => State)

/** External store with a monotonic revision; snapshots stay readable after dispose. */
export class RevisionedStore<State> implements ExternalStore<State> {
  private state: State
  private revision = 0
  private disposed = false
  private readonly listeners = new Set<() => void>()

  constructor(initialState: State) {
    this.state = initialState
  }

  getSnapshot = (): State => {
    // React may call getSnapshot while a store races disposal (e.g. a
    // transport swap disposes the old runtime while the old subtree is
    // unmounting). Returning the last snapshot lets React finish the
    // render and unmount cleanly. The store no longer changes.
    return this.state
  }

  getRevision = (): number => this.revision

  subscribe = (listener: () => void): Unsubscribe => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setState = (next: StateUpdater<State>): void => {
    if (this.disposed) return
    const nextState =
      typeof next === 'function' ? (next as (current: State) => State)(this.state) : next
    if (Object.is(nextState, this.state)) return
    this.state = nextState
    this.revision += 1
    for (const listener of this.listeners) listener()
  }

  dispose = (): void => {
    if (this.disposed) return
    this.disposed = true
    this.listeners.clear()
  }
}

/** Generation counter for invalidating stale async responses. */
export class GenerationGate {
  private generation = 0

  current(): number {
    return this.generation
  }

  next(): number {
    this.generation += 1
    return this.generation
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation
  }

  assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) {
      throw new Error(`Stale generation ${generation}; current generation is ${this.generation}.`)
    }
  }
}

/** Collects unsubscribe/dispose callbacks, run in reverse order on dispose. */
export class SubscriptionScope {
  private readonly cleanups = new Set<Unsubscribe>()
  private disposed = false

  add(unsubscribe: Unsubscribe): Unsubscribe {
    this.assertOpen()
    this.cleanups.add(unsubscribe)
    return () => {
      if (!this.cleanups.delete(unsubscribe)) return
      unsubscribe()
    }
  }

  addSubscription<Snapshot>(store: ExternalStore<Snapshot>, listener: () => void): void {
    this.add(store.subscribe(listener))
  }

  child(): SubscriptionScope {
    const child = new SubscriptionScope()
    this.add(() => child.dispose())
    return child
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const cleanups = [...this.cleanups].reverse()
    this.cleanups.clear()
    for (const cleanup of cleanups) cleanup()
  }

  private assertOpen(): void {
    if (this.disposed) throw new Error('SubscriptionScope is disposed.')
  }
}

export type ScopedRuntimeRegistryOptions<T> = Readonly<{
  maxEntries?: number
  softMax?: number
  dispose?: (value: T, scopeKey: string) => void
  isActive?: (value: T) => boolean
}>

export type RuntimeKey = string | Readonly<{ readonly key: string }>

export type ScopedRuntimeRegistryStats = Readonly<{
  size: number
  activeCount: number
  inactiveCount: number
  maxEntries: number
  softMax: number
  softMaxWarnings: number
}>

/**
 * Module-level registry of retained runtimes keyed by scope.
 * `get()` hits return the same instance without disposing; `touch()` refreshes
 * LRU recency; only overflow past `maxEntries` (or explicit delete) disposes.
 * This is what makes "switching back is instant": components unmount but the
 * cached data survives in the registry.
 */
export class ScopedRuntimeRegistry<T> {
  private readonly entries = new Map<string, { value: T; lastTouchedAt: number }>()
  private readonly maxEntries: number
  private readonly softMax: number
  private readonly disposeEntry?: ((value: T, scopeKey: string) => void) | undefined
  private readonly isActive?: ((value: T) => boolean) | undefined
  private touchClock = 0
  private softMaxWarnings = 0

  constructor(options: ScopedRuntimeRegistryOptions<T> = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 12)
    this.softMax = Math.max(this.maxEntries, options.softMax ?? Math.max(this.maxEntries * 2, 32))
    this.disposeEntry = options.dispose
    this.isActive = options.isActive
  }

  get(scopeKey: RuntimeKey): T | undefined {
    return this.entries.get(runtimeKeyString(scopeKey))?.value
  }

  has(scopeKey: RuntimeKey): boolean {
    return this.entries.has(runtimeKeyString(scopeKey))
  }

  getOrCreate(scopeKey: RuntimeKey, factory: () => T): T {
    const key = runtimeKeyString(scopeKey)
    const existing = this.entries.get(key)
    if (existing !== undefined) {
      this.entries.set(key, { value: existing.value, lastTouchedAt: this.nextTouch() })
      return existing.value
    }
    const value = factory()
    this.entries.set(key, { value, lastTouchedAt: this.nextTouch() })
    this.evictOverflow()
    return value
  }

  touch(scopeKey: RuntimeKey): void {
    const key = runtimeKeyString(scopeKey)
    const existing = this.entries.get(key)
    if (existing === undefined) return
    this.entries.set(key, { value: existing.value, lastTouchedAt: this.nextTouch() })
  }

  set(scopeKey: RuntimeKey, value: T): void {
    const key = runtimeKeyString(scopeKey)
    const previous = this.entries.get(key)
    if (previous !== undefined && previous.value !== value) {
      this.disposeEntry?.(previous.value, key)
    }
    this.entries.set(key, { value, lastTouchedAt: this.nextTouch() })
    this.evictOverflow()
  }

  update(scopeKey: RuntimeKey, value: T): boolean {
    const key = runtimeKeyString(scopeKey)
    if (!this.entries.has(key)) return false
    this.entries.set(key, { value, lastTouchedAt: this.nextTouch() })
    this.evictOverflow()
    return true
  }

  delete(scopeKey: RuntimeKey): boolean {
    const key = runtimeKeyString(scopeKey)
    const existing = this.entries.get(key)
    if (existing === undefined) return false
    this.entries.delete(key)
    this.disposeEntry?.(existing.value, key)
    return true
  }

  clear(): void {
    for (const [scopeKey, entry] of this.entries) this.disposeEntry?.(entry.value, scopeKey)
    this.entries.clear()
  }

  size(): number {
    return this.entries.size
  }

  keys(): ReadonlyArray<string> {
    return [...this.entries.keys()]
  }

  values(): ReadonlyArray<T> {
    return [...this.entries.values()].map(entry => entry.value)
  }

  getStats(): ScopedRuntimeRegistryStats {
    let activeCount = 0
    for (const entry of this.entries.values()) {
      if (this.isActive?.(entry.value) === true) activeCount += 1
    }
    const size = this.entries.size
    return {
      size,
      activeCount,
      inactiveCount: size - activeCount,
      maxEntries: this.maxEntries,
      softMax: this.softMax,
      softMaxWarnings: this.softMaxWarnings,
    }
  }

  private nextTouch(): number {
    this.touchClock += 1
    return this.touchClock
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      let oldestKey: string | undefined
      let oldestTouched = Number.POSITIVE_INFINITY
      for (const [scopeKey, entry] of this.entries) {
        if (this.isActive?.(entry.value) === true) continue
        if (entry.lastTouchedAt < oldestTouched) {
          oldestTouched = entry.lastTouchedAt
          oldestKey = scopeKey
        }
      }
      if (oldestKey === undefined) break
      this.delete(oldestKey)
    }
    if (this.entries.size > this.softMax) this.softMaxWarnings += 1
  }
}

function runtimeKeyString(scopeKey: RuntimeKey): string {
  return typeof scopeKey === 'string' ? scopeKey : scopeKey.key
}

export type ResourceState<T, E> =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'loading'; generation: number }>
  | Readonly<{ status: 'ready'; data: T; revision: number }>
  | Readonly<{ status: 'error'; error: E; generation: number }>

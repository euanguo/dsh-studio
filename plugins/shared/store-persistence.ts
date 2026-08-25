/**
 * Shared template-C persistence facade (`persistVia`) and its single-flight
 * flush primitive.
 *
 * "Template C" was the five near-identical hand-written persist layers
 * (subscribe → debounced save + async hydrate + changedBeforeHydrate race
 * guard + flush on teardown) that used to live in chrome-store,
 * center-surface-persistence, sidebar-service, desktop-skins
 * preferences-storage and ui-chrome-flags. This module owns that machinery
 * once so every consumer shares the same race guards and teardown contract
 * instead of re-declaring them.
 *
 * Two trigger models are unified:
 * - push  — `store.subscribe` fires the subscriber on identity-state change;
 * - pull  — `fire()` explicitly persists the current snapshot (passive
 *   consumers such as the skins StorageLike adapter and the sidebar service
 *   that persist only at marked mutators).
 *
 * The persisted value (`V`) is decoupled from the in-memory identity state
 * when they differ (e.g. the sidebar service stores a `version` header and
 * the center-surface store persists a projection, not live slices). The
 * consumer provides `snapshot()`/`apply()` for that mapping.
 */
import { createUiChromeStorage } from './ui-chrome-storage.ts'
import type { UiChromeTableName } from './ui-chrome-tables.ts'

/** The backing persistence seam: load the stored value, save it, drain it. */
export interface PersistBackend<V> {
  load(): Promise<V>
  save(value: V): void
  flush(): Promise<void>
}

/** The identity-state source the facade subscribes to and hydrates into. */
export interface PersistStore<V> {
  /** Observe identity-state changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Snapshot the current identity-state value to persist. */
  snapshot(): V
  /** Apply a hydrated (merged) value back into identity state. */
  apply(value: V): void
}

export interface PersistViaOptions<V> {
  /**
   * Backing persistence. When omitted one is built from `table` +
   * `defaults` + `sanitize` + `debounceMs` (a UiChromeStorage handle).
   */
  backend?: PersistBackend<V>
  /** UI chrome table used when no `backend` is injected. */
  table?: UiChromeTableName
  /** Identity default used when no `backend` is injected. */
  defaults?(): V
  /** Release sanitizer; frames the stored value into a typed value. */
  sanitize?(raw: unknown): V
  /** Debounce window for save when no `backend` is injected. */
  debounceMs?: number
  /**
   * Field-level merge of a stored value with concurrent identity changes
   * made while the async read was pending. Called only when a change landed
   * before hydration (the `changedBeforeHydrate` path).
   */
  merge(stored: V, current: V): V
  /**
   * Whether the facade drives hydration itself (subscribe → load → merge →
   * apply → save). Set false for passive consumers that hydrate their own
   * store (sidebar service, skins) and only need the save/flush pump.
   * Default true.
   */
  hydrate?: boolean
}

export interface PersistViaHandle {
  /** Unsubscribe and flush any pending write. */
  stop(): void
  /** Awaits the async load+apply (+ any changed-before-hydrate save). */
  ready: Promise<void>
  /** Explicitly persist the current snapshot (passive trigger model). */
  fire(): void
  /** Drain pending writes (alias of `stop().flush` used by settle). */
  flush(): Promise<void>
}

/**
 * Template-C facade. Owns the changedBeforeHydrate / applyingHydration race
 * guards and the teardown flush that were previously scattered across five
 * consumers.
 */
export function persistVia<V>(
  store: PersistStore<V>,
  options: PersistViaOptions<V>,
): PersistViaHandle {
  const backend: PersistBackend<V> = options.backend ?? newUiChromeBackend(options)
  const hydrate = options.hydrate !== false

  let active = true
  let hydrated = false
  let applying = false
  let changedBeforeHydrate = false
  let readyResolve: () => void = () => {}
  let ready = new Promise<void>(resolve => { readyResolve = resolve })

  const persist = (): void => {
    if (applying) return
    if (hydrated) backend.save(store.snapshot())
    else changedBeforeHydrate = true
  }

  const stopSubscribe = store.subscribe(persist)

  if (hydrate) {
    void backend.load().then(stored => {
      if (!active) return
      applying = true
      try {
        const merged = changedBeforeHydrate
          ? options.merge(stored, store.snapshot())
          : stored
        store.apply(merged)
      } finally {
        applying = false
      }
      hydrated = true
      if (changedBeforeHydrate) {
        changedBeforeHydrate = false
        backend.save(store.snapshot())
      }
      readyResolve()
    })
  } else {
    // No auto-hydrate: element starts hydrated so explicit saves flow through.
    hydrated = true
    readyResolve()
  }

  const stop = (): void => {
    active = false
    stopSubscribe()
    void backend.flush()
  }

  return {
    stop,
    ready,
    fire: persist,
    flush: () => backend.flush(),
  }
}

function newUiChromeBackend<V>(options: PersistViaOptions<V>): PersistBackend<V> {
  if (options.table === undefined) {
    throw new Error('persistVia: a `table` (or injected `backend`) is required')
  }
  return createUiChromeStorage<V>({
    table: options.table,
    defaults: options.defaults ?? (() => ({}) as V),
    sanitize: options.sanitize ?? (raw => raw as V),
    ...(options.debounceMs === undefined ? {} : { debounceMs: options.debounceMs }),
  })
}
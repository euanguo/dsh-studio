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
import type { StateSliceDefinition } from './contracts/workbench-contracts.ts'

/** The backing persistence seam: load the stored value, save it, drain it. */
export interface PersistBackend<V> {
  load(): Promise<V>
  /**
   * Strict load: THROWS on transport failure instead of resolving defaults.
   * When present, the facade's hydration prefers it and retries transient
   * failures, so a short outage cannot hydrate defaults and later persist
   * them over the intact host record.
   */
  loadStrict?(): Promise<V>
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
    void hydrateWithRetry()
  } else {
    // No auto-hydrate: element starts hydrated so explicit saves flow through.
    hydrated = true
    readyResolve()
  }

  /**
   * Hydrate with bounded retry on strict loads. A transient transport outage
   * must not resolve into defaults (which a later save would write back over
   * the intact host record); after exhausting retries we fall back to the
   * legacy defaults path so consumers still boot, loudly.
   */
  const HYDRATE_RETRY_LIMIT = 6
  async function hydrateWithRetry(): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const stored = backend.loadStrict !== undefined
          ? await backend.loadStrict()
          : await backend.load()
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
        return
      } catch (error) {
        attempt += 1
        if (!active || attempt >= HYDRATE_RETRY_LIMIT || backend.loadStrict === undefined) {
          console.warn('[persist] hydrate failed; continuing with defaults', error)
          try {
            const stored = await backend.load()
            if (active) {
              applying = true
              try {
                const merged = changedBeforeHydrate
                  ? options.merge(stored, store.snapshot())
                  : stored
                store.apply(merged)
                hydrated = true
                if (changedBeforeHydrate) {
                  changedBeforeHydrate = false
                  backend.save(store.snapshot())
                }
              } finally {
                applying = false
              }
            }
          } finally {
            readyResolve()
          }
          return
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(8_000, 400 * 2 ** (attempt - 1))))
      }
    }
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

/* ── StateStore slice policy over a persistence backend ────────────────── */

/**
 * A {@linkcode StateSliceDefinition} plus the storage encoding tier.
 *
 * - `'envelope'` (default): every write persists a `{ version, data }`
 *   envelope so the stored generation is explicit and the `migrate` /
 *   `reset` tiers of `onIncompatible` are decided from the stored version
 *   (forward versions always reset — they can never migrate into the past).
 *   This is the kernel `defineStateSlice` wire format.
 * - `'bare'`: the host table DTO shape is fixed on the wire (no version
 *   field may be added), so compatibility is expressed by the definition's
 *   `migrate` normalize hook, which runs on EVERY read AND write. The hook
 *   must be idempotent; `onIncompatible:'reset'` additionally drops values
 *   the hook cannot recognize instead of normalizing them.
 */
export interface PersistedSliceDefinition<T> extends StateSliceDefinition<T> {
  encoding?: 'envelope' | 'bare'
}

interface SliceEnvelope {
  version: number
  data: unknown
}

function isSliceEnvelope(raw: unknown): raw is SliceEnvelope {
  return (
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    && typeof (raw as SliceEnvelope).version === 'number'
    && 'data' in (raw as SliceEnvelope)
  )
}

function validatePersistedSlice<T>(definition: PersistedSliceDefinition<T>): void {
  const { table, version, scope, onIncompatible, migrate, encoding = 'envelope' } = definition
  if (typeof table !== 'string' || table.trim() === '') {
    throw new Error('persisted slice requires a non-empty table')
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`persisted slice ${table} requires a positive integer version`)
  }
  if (scope !== 'workspace' && scope !== 'session' && scope !== 'global') {
    throw new Error(`persisted slice ${table} has an unknown scope: ${String(scope)}`)
  }
  if (encoding !== 'envelope' && encoding !== 'bare') {
    throw new Error(`persisted slice ${table} has an unknown encoding: ${String(encoding)}`)
  }
  if (onIncompatible === 'migrate' && migrate === undefined) {
    throw new Error(`persisted slice ${table} declares onIncompatible:'migrate' without a migrate hook`)
  }
}

/**
 * Route one table's loads and saves through its slice's version policy.
 * This is the single-writer seam between the shared persistVia facade and
 * the StateStore slice vocabulary: the owning module declares ONE
 * definition per table and wraps its storage handle with it, so format
 * bumps have exactly one place to land (`migrate`) or to drop (`reset`).
 */
export function persistedSliceBackend<T>(
  definition: PersistedSliceDefinition<T>,
  backend: PersistBackend<unknown>,
): PersistBackend<T> {
  validatePersistedSlice(definition)
  const { version, migrate, encoding = 'envelope' } = definition
  // Bare tables normalize through the hook when one is declared; envelope
  // tables decide from the stored generation instead.
  const normalizeBare = (raw: unknown): T | undefined => {
    if (raw === undefined || raw === null) return undefined
    if (migrate === undefined) return raw as T
    try {
      return migrate(raw, 0)
    } catch (error) {
      // Unrecognizable bare payload: 'reset' drops it to defaults,
      // 'migrate' keeps the failure loud for the facade's retry path.
      if ((definition.onIncompatible ?? 'reset') === 'reset') return undefined
      throw error
    }
  }

  const applyPolicy = async (load: () => Promise<unknown>): Promise<T | undefined> => {
    const raw = await load()
    if (encoding === 'bare') return normalizeBare(raw)
    if (raw === undefined || raw === null) return undefined
    if (!isSliceEnvelope(raw)) {
      // A pre-envelope record follows the same two-tier policy, addressed
      // as generation 0 ("before versioning existed").
      return (definition.onIncompatible ?? 'reset') === 'migrate'
        ? migrate?.(raw, 0)
        : undefined
    }
    if (raw.version === version) return raw.data as T
    // Forward generations can never migrate into the past.
    if (raw.version > version || (definition.onIncompatible ?? 'reset') === 'reset') {
      return undefined
    }
    return migrate?.(raw.data, raw.version)
  }

  return {
    load: async () => (await applyPolicy(() => backend.load())) as T,
    loadStrict: async () => (await applyPolicy(() =>
      backend.loadStrict !== undefined ? backend.loadStrict() : backend.load())) as T,
    save(value) {
      backend.save(encoding === 'bare' ? value : { version, data: value })
    },
    flush: () => backend.flush(),
  }
}
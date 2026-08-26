/**
 * ScopeService + StateStore implementation — the unified retained-state
 * layer skeleton (target-design §3.4). One slice owns one table (single-
 * writer principle); buckets come from the shared `resolveScopeBucket`
 * decision so stores stop interpreting scope on their own. Persistence sits
 * behind the `StatePersistenceAdapter` seam: this module ships the in-memory
 * adapter; later leaves wire the shared `persistVia` facade without changing
 * slice semantics.
 *
 * Consumers receive the service only through the `workbench.state` ctx
 * service. No DOM, no React, no cordis imports.
 */
import type {
  ScopeLevel,
  ScopeService,
  StatePersistenceAdapter,
  StateSlice,
  StateSliceDefinition,
  StateStore,
} from '@dsh-studio/shared/workbench-contracts'
import { resolveScopeBucket } from '@dsh-studio/shared/workbench-contracts'

/** Stored envelope written by every {@linkcode StateSlice.set}. */
interface SliceEnvelope {
  version: number
  data: unknown
}

function isEnvelope(raw: unknown): raw is SliceEnvelope {
  return (
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    && typeof (raw as SliceEnvelope).version === 'number'
    && 'data' in (raw as SliceEnvelope)
  )
}

function validateDefinition<T>(definition: StateSliceDefinition<T>): void {
  if (typeof definition.table !== 'string' || definition.table.trim() === '') {
    throw new Error('state slice requires a non-empty table')
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`state slice ${definition.table} requires a positive integer version`)
  }
  const scope: ScopeLevel = definition.scope
  if (scope !== 'workspace' && scope !== 'session' && scope !== 'global') {
    throw new Error(`state slice ${definition.table} has an unknown scope: ${String(scope)}`)
  }
  if (definition.onIncompatible === 'migrate' && definition.migrate === undefined) {
    throw new Error(
      `state slice ${definition.table} declares onIncompatible:'migrate' without a migrate hook`,
    )
  }
}

export function defineStateSlice<T>(
  definition: StateSliceDefinition<T>,
  adapter: StatePersistenceAdapter,
): StateSlice<T> {
  validateDefinition(definition)
  const { table, version } = definition
  const policy = definition.onIncompatible ?? 'reset'
  const dropAndReset = (bucket: string): undefined => {
    adapter.write(table, bucket, undefined)
    return undefined
  }
  return {
    definition,
    get(bucket) {
      const raw = adapter.read(table, bucket)
      if (raw === undefined || raw === null) return undefined
      // Anything that is not one of our envelopes is an incompatible legacy
      // format by construction and follows the same reset/migrate policy.
      if (!isEnvelope(raw)) {
        return policy === 'migrate' ? definition.migrate?.(raw, 0) : dropAndReset(bucket)
      }
      if (raw.version === version) return raw.data as T
      if (raw.version > version || policy === 'reset') {
        // Forward versions can never be migrated into the past.
        return dropAndReset(bucket)
      }
      return definition.migrate?.(raw.data, raw.version)
    },
    set(bucket, value) {
      adapter.write(table, bucket, { version, data: value })
    },
    delete(bucket) {
      adapter.write(table, bucket, undefined)
    },
  }
}

/** In-memory adapter for tests and pre-persistence consumers. */
export function createMemoryAdapter(): StatePersistenceAdapter & {
  snapshot(): Map<string, unknown>
} {
  const cells = new Map<string, unknown>()
  const key = (table: string, bucket: string) => `${table}\u0000${bucket}`
  return {
    read(table, bucket) {
      return cells.get(key(table, bucket))
    },
    write(table, bucket, value) {
      if (value === undefined) cells.delete(key(table, bucket))
      else cells.set(key(table, bucket), value)
    },
    snapshot() {
      return new Map(cells)
    },
  }
}

export function createStateStore(adapter: StatePersistenceAdapter): StateStore {
  const ownedTables = new Set<string>()
  const scope: ScopeService = {
    bucket(level, key) {
      return resolveScopeBucket(level, key)
    },
  }
  return {
    scope,
    slice<T>(definition: StateSliceDefinition<T>): StateSlice<T> {
      validateDefinition(definition)
      if (ownedTables.has(definition.table)) {
        throw new Error(`table already has a slice owner: ${definition.table}`)
      }
      ownedTables.add(definition.table)
      return defineStateSlice(definition, adapter)
    },
  }
}

/**
 * StateStore slice behavior tests (kernel-refactor leaf-1.4).
 *
 * Covers the two tiers of the unified retained-state layer:
 * - the kernel `defineStateSlice` factory (envelope encoding): set/get,
 *   schemaVersion migration hooks, and BOTH `onIncompatible` tiers
 *   (`migrate` folds older generations forward; `reset` drops them;
 *   forward generations always reset — they can never migrate into the
 *   past);
 * - the shared `persistedSliceBackend` policy seam (the host-domain flavor
 *   used by chrome-store / center-surfaces, whose fixed wire DTOs declare
 *   the `bare` encoding): read/write normalization and the same reset tier,
 *   plus the changed-before-hydrate merge running END TO END through the
 *   real persistVia facade when a write lands while hydration is pending.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GLOBAL_SCOPE_BUCKET } from '../plugins/shared/contracts/workbench-contracts.ts'
import {
  persistedSliceBackend,
  persistVia,
  type PersistBackend,
  type PersistedSliceDefinition,
} from '../plugins/shared/store-persistence.ts'
import {
  createMemoryAdapter,
  createStateStore,
  defineStateSlice,
} from '../plugins/workbench/src/state.ts'

function memoryBackend(): PersistBackend<unknown> & { written: unknown[] } {
  const written: unknown[] = []
  return {
    async load() {
      return undefined
    },
    save(value) {
      written.push(value)
    },
    async flush() {},
    written,
  }
}

test('envelope slice: set writes a version-stamped envelope; get reads it back', () => {
  const adapter = createMemoryAdapter()
  const slice = defineStateSlice<{ mode: string }>({
    table: 't_roundtrip',
    scope: 'workspace',
    version: 2,
  }, adapter)
  slice.set('/repo', { mode: 'unified' })
  assert.deepEqual(adapter.read('t_roundtrip', '/repo'), { version: 2, data: { mode: 'unified' } })
  assert.deepEqual(slice.get('/repo'), { mode: 'unified' })
})

test('envelope slice: an older generation is migrated forward with its source version', () => {
  const adapter = createMemoryAdapter()
  const seen: number[] = []
  const slice = defineStateSlice<{ layout: string }>({
    table: 't_migrate',
    scope: 'workspace',
    version: 3,
    onIncompatible: 'migrate',
    migrate: (raw, fromVersion) => {
      seen.push(fromVersion)
      return { layout: (raw as { value?: string }).value ?? 'tree' }
    },
  }, adapter)
  adapter.write('t_migrate', '/repo', { version: 1, data: { value: 'flat' } })
  assert.deepEqual(slice.get('/repo'), { layout: 'flat' })
  assert.deepEqual(seen, [1])
})

test('envelope slice: onIncompatible reset drops an older generation instead of migrating', () => {
  const adapter = createMemoryAdapter()
  let migrateRan = false
  const slice = defineStateSlice<string>({
    table: 't_reset',
    scope: 'workspace',
    version: 2,
    onIncompatible: 'reset',
    migrate: () => {
      migrateRan = true
      return 'migrated'
    },
  }, adapter)
  adapter.write('t_reset', '/repo', { version: 1, data: 'old' })
  assert.equal(slice.get('/repo'), undefined)
  assert.equal(migrateRan, false)
  // Reset is destructive for that bucket only: reading again stays empty.
  assert.equal(adapter.read('t_reset', '/repo'), undefined)
})

test('envelope slice: a forward generation can never migrate and always resets', () => {
  const adapter = createMemoryAdapter()
  let migrateRan = false
  const slice = defineStateSlice<string>({
    table: 't_forward',
    scope: 'workspace',
    version: 2,
    onIncompatible: 'migrate',
    migrate: () => {
      migrateRan = true
      return 'nope'
    },
  }, adapter)
  adapter.write('t_forward', '/repo', { version: 9, data: 'from-the-future' })
  assert.equal(slice.get('/repo'), undefined)
  assert.equal(migrateRan, false)
})

test('envelope slice: a pre-envelope legacy record follows the declared tier', () => {
  const adapter = createMemoryAdapter()
  const migrating = defineStateSlice<{ kept: boolean }>({
    table: 't_legacy_migrate',
    scope: 'workspace',
    version: 1,
    onIncompatible: 'migrate',
    migrate: raw => ({ kept: raw === 'legacy-blob' }),
  }, adapter)
  adapter.write('t_legacy_migrate', '/a', 'legacy-blob')
  assert.deepEqual(migrating.get('/a'), { kept: true })

  const resetting = defineStateSlice<{ kept: boolean }>({
    table: 't_legacy_reset',
    scope: 'workspace',
    version: 1,
    migrate: raw => ({ kept: raw === 'legacy-blob' }),
  }, adapter)
  adapter.write('t_legacy_reset', '/b', 'legacy-blob')
  assert.equal(resetting.get('/b'), undefined)
})

test('envelope slice: delete drops the bucket and get yields undefined afterwards', () => {
  const adapter = createMemoryAdapter()
  const slice = defineStateSlice<number>({
    table: 't_delete',
    scope: 'session',
    version: 1,
  }, adapter)
  slice.set('s1', 42)
  assert.equal(slice.get('s1'), 42)
  slice.delete('s1')
  assert.equal(slice.get('s1'), undefined)
})

test('one table has exactly one slice owner per store; separate stores do not collide', () => {
  const definition = {
    table: 'owned',
    scope: 'global' as const,
    version: 1,
  }
  const store = createStateStore(createMemoryAdapter())
  store.slice(definition)
  assert.throws(() => store.slice(definition), /already has a slice owner/)
  // A second store instance owns its own table set (per-runtime ownership).
  createStateStore(createMemoryAdapter()).slice(definition)
})

test('scope buckets come from resolveScopeBucket: workspace/session key, global collapses', () => {
  const store = createStateStore(createMemoryAdapter())
  assert.equal(store.scope.bucket('workspace', '/repo'), '/repo')
  assert.equal(store.scope.bucket('session', 's-1'), 's-1')
  assert.equal(store.scope.bucket('global', null), GLOBAL_SCOPE_BUCKET)
  assert.equal(store.scope.bucket('workspace', ''), GLOBAL_SCOPE_BUCKET)
})

test('persistedSliceBackend envelope encoding: loads migrate old generations, saves stamp the current one', async () => {
  const backend = memoryBackend()
  backend.written.push({ version: 1, data: 'old-shape' })
  const sliced = persistedSliceBackend<string>({
    table: 'wire',
    scope: 'global',
    version: 2,
    onIncompatible: 'migrate',
    migrate: raw => `migrated:${String(raw)}`,
  }, {
    load: async () => backend.written.at(-1),
    save: value => backend.written.push(value),
    flush: async () => {},
  })
  assert.equal(await sliced.load(), 'migrated:old-shape')
  await sliced.save('fresh')
  assert.deepEqual(backend.written.at(-1), { version: 2, data: 'fresh' })
})

test('persistedSliceBackend bare encoding: every read and write passes the normalize hook; reset drops unrecognized payloads', async () => {
  let calls = 0
  const definition: PersistedSliceDefinition<{ byScope: Record<string, string> }> = {
    table: 'bare',
    scope: 'workspace',
    version: 1,
    encoding: 'bare',
    onIncompatible: 'migrate',
    migrate: raw => {
      calls += 1
      if (typeof raw !== 'object' || raw === null || !('byScope' in raw)) {
        throw new Error('unrecognizable')
      }
      return raw as { byScope: Record<string, string> }
    },
  }
  const raw = { byScope: { '/repo': {} } }
  const sliced = persistedSliceBackend(definition, {
    load: async () => raw,
    save: () => {},
    flush: async () => {},
  })
  assert.deepEqual(await sliced.load(), raw)
  assert.equal(calls, 1)

  const resetSliced = persistedSliceBackend({
    ...definition,
    onIncompatible: 'reset',
  }, {
    load: async () => 'garbage',
    save: () => {},
    flush: async () => {},
  })
  assert.deepEqual(await resetSliced.load(), undefined)
})

test('changed-before-hydrate merge runs end to end through persistVia over a sliced backend', async () => {
  interface Stored {
    byScope: Record<string, { commitMessage: string }>
  }
  let releaseLoad!: () => void
  const gate = new Promise<void>(resolve => { releaseLoad = () => resolve() })
  const storedValue: Stored = { byScope: { '/repo': { commitMessage: 'persisted draft' } } }
  const written: unknown[] = []
  const slowBackend: PersistBackend<unknown> = {
    load: () => new Promise<unknown>(resolve => {
      releaseLoad()
      gate.then(() => resolve(storedValue))
    }),
    save: value => { written.push(value) },
    flush: async () => {},
  }
  const sliced = persistedSliceBackend<Stored>({
    table: 'race',
    scope: 'workspace',
    version: 1,
    encoding: 'bare',
  }, slowBackend)

  let applied: Stored | undefined
  let snapshot: Stored = { byScope: {} }
  const handle = persistVia<Stored>(
    {
      subscribe: listener => {
        snapshot = { byScope: { '/repo': { commitMessage: 'early edit' } } }
        listener()
        return () => {}
      },
      snapshot: () => snapshot,
      apply: value => { applied = value },
    },
    {
      backend: sliced,
      // Field-level union: persisted scopes stay, early edits win for the
      // scopes they touched (the chrome-store merge contract, in miniature).
      merge: (storedSlice, current) => ({
        byScope: {
          ...storedSlice.byScope,
          ...Object.fromEntries(Object.entries(current.byScope).map(([scope, entry]) => [
            scope,
            {
              ...storedSlice.byScope[scope],
              commitMessage: entry.commitMessage
                || storedSlice.byScope[scope]?.commitMessage
                || '',
            },
          ])),
        },
      }),
    },
  )
  await handle.ready
  // The early change survived hydration instead of being overwritten.
  assert.equal(applied?.byScope['/repo']?.commitMessage, 'early edit')
  // And the reconciled snapshot was saved back once hydration landed.
  const saved = written.at(-1) as Stored | undefined
  assert.equal(saved?.byScope['/repo']?.commitMessage, 'early edit')
  handle.stop()
})

test('persistedSliceBackend validates its definition before wrapping a backend', () => {
  assert.throws(() => persistedSliceBackend({
    table: '',
    scope: 'global',
    version: 1,
  }, memoryBackend()), /non-empty table/)
  assert.throws(() => persistedSliceBackend({
    table: 'bad-version',
    scope: 'global',
    version: 0,
  }, memoryBackend()), /positive integer version/)
  assert.throws(() => persistedSliceBackend({
    table: 'bad-hook',
    scope: 'global',
    version: 1,
    onIncompatible: 'migrate',
  }, memoryBackend()), /without a migrate hook/)
})

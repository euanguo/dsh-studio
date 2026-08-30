/**
 * leaf-1.5 unification contract for the desktop-left-rail retained-state
 * family. Everything here exercises REAL modules against a fake capabilities
 * transport:
 *
 * - the workspace viewing store is built on the shared/runtime family and
 *   keeps the exact persisted-view behaviors (hydrate merge semantics,
 *   account-key retention, order/expansion round-trips);
 * - the view-chrome channel persists through the shared persistVia facade
 *   onto the host-owned `left_rail_view` table;
 * - the user-profile channel persists through the persistVia settings
 *   backend using deletion-capable path ops under CAS;
 * - the 7595452 data-safety rule holds end to end: a failed chrome hydrate
 *   is a STRICT failure (never defaults), and a paused surface never emits a
 *   save-back while the transport is down.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createWorkspaceViewStore,
  FLAT_SESSION_ORDER_KEY,
} from '../plugins/desktop-left-rail/src/client/stores.ts'
import {
  flushLeftRailChrome,
  loadLeftRailChrome,
  saveLeftRailChrome,
} from '../plugins/desktop-left-rail/src/client/left-rail-chrome.ts'
import {
  diffSettingsOps,
  loadLeftRailSettings,
  saveLeftRailSettings,
  startLeftRailSettingsPersistence,
  withSettingsCas,
} from '../plugins/desktop-left-rail/src/client/left-rail-settings.ts'
import {
  defaultLeftRailViewChrome,
  UI_CHROME_TABLES,
} from '@dsh-studio/shared/ui-chrome-tables'
import { LEFT_RAIL_SETTINGS_NS, type LeftRailSettings } from '@dsh-studio/shared/left-rail-preferences'
import type { ProjectIconPreference } from '../plugins/desktop-left-rail/src/client/domain/project-icon.ts'

/* ── fake /capabilities transport ──────────────────────────────────────── */

interface FakeRequest {
  url: string
  body: Record<string, unknown>
}

type PathOp = { op: 'set' | 'unset'; path: string[]; value?: unknown }

/** Applies deletion-capable path ops exactly like the host settings seam. */
function applyPathOp(section: Record<string, unknown>, op: PathOp): void {
  const [head, ...rest] = op.path
  if (head === undefined) return
  if (rest.length === 0) {
    if (op.op === 'unset') delete section[head]
    else section[head] = op.value
    return
  }
  if (typeof section[head] !== 'object' || section[head] === null || Array.isArray(section[head])) {
    if (op.op === 'unset') return
    section[head] = {}
  }
  applyPathOp(section[head] as Record<string, unknown>, { ...op, path: rest })
}

class FakeCapabilities {
  readonly requests: FakeRequest[] = []
  readonly tables = new Map<string, unknown>()
  readonly namespaces = new Map<string, { section: Record<string, unknown>; revision: number }>()
  /** When set, every request rejects with this error (transport outage). */
  outage: Error | null = null
  /**
   * When set, the NEXT settings.mutate loses a CAS race: the concurrent
   * section is applied first (another surface won), then the caller sees a
   * settings-conflict envelope.
   */
  conflictOnceWith: Record<string, unknown> | null = null

  install(): void {
    const self = this
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const spec = self.requests
      const target = String(url)
      const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (self.outage !== null) throw self.outage
      const method = target.slice('/capabilities/api/'.length)
      let value: unknown
      let ok = true
      if (method === 'ui-chrome.get') {
        value = { value: self.tables.get(payload.table as string) }
      } else if (method === 'ui-chrome.put') {
        self.tables.set(payload.table as string, payload.value)
        value = {}
      } else if (method === 'settings.get') {
        const entry = self.namespaces.get(payload.ns as string)
        value = entry === undefined ? {} : { value: structuredClone(entry.section), revision: entry.revision }
      } else if (method === 'settings.mutate') {
        const ns = payload.ns as string
        if (self.conflictOnceWith !== null) {
          // Another surface wins the race: its whole section lands first.
          self.namespaces.set(ns, { section: structuredClone(self.conflictOnceWith), revision: (self.namespaces.get(ns)?.revision ?? 0) + 1 })
          self.conflictOnceWith = null
          ok = false
          spec.push({ url: target, body: payload })
          return {
            ok: false,
            status: 409,
            json: async () => ({ ok: false, error: { code: 'settings-conflict', message: 'revision conflict' } }),
          } as unknown as Response
        }
        const entry = self.namespaces.get(ns) ?? { section: {} as Record<string, unknown>, revision: 0 }
        const next = structuredClone(entry.section)
        for (const op of payload.ops as PathOp[]) applyPathOp(next, op)
        self.namespaces.set(ns, { section: next, revision: entry.revision + 1 })
        value = { value: structuredClone(next), revision: entry.revision + 1 }
      } else {
        throw new Error(`unexpected capabilities method: ${method}`)
      }
      spec.push({ url: target, body: payload })
      return {
        ok,
        status: ok ? 200 : 400,
        json: async () => ({ ok: true, value }),
      } as unknown as Response
    }) as typeof fetch
  }

  calls(method: string): FakeRequest[] {
    return this.requests.filter(request => request.url === `/capabilities/api/${method}`)
  }

  namespace(name: string): Record<string, unknown> {
    return this.namespaces.get(name)?.section ?? {}
  }
}

function withTransport(owner: FakeCapabilities, run: () => Promise<void>): Promise<void> {
  const previous = globalThis.fetch
  owner.install()
  return run().finally(() => {
    globalThis.fetch = previous
  })
}

/* ── G1a: view-store behavior parity ───────────────────────────────────── */

test('workspace view store keeps hydrate merge, retention, and order round-trip semantics', () => {
  const handle = createWorkspaceViewStore()
  const instance = handle.create()
  const states: Array<Record<string, unknown>> = []
  const unsubscribe = instance.subscribe(() => { states.push(instance.getSnapshot()) })

  // Defaults.
  assert.equal(instance.getSnapshot().groupBy, 'workspace')
  assert.equal(instance.getSnapshot().activeTab, '__default__')

  const actions = instance.actions
  actions.syncSessionOrderAccount('ws-1', ['s-2', 's-1'], { 's-1': 5, 's-2': 9 })
  actions.syncSessionOrderAccount(FLAT_SESSION_ORDER_KEY, ['s-3'], { 's-3': 7 })
  actions.setGroupExpanded('exp:repo-a', true)
  actions.setGroupExpanded('exp:stale', true)
  actions.setGroupBy('flat')
  actions.setOrderBy('manual')

  // Hydrate merge: chrome wins the persisted fields while the observed-update
  // snapshot rides along (decision C30 — discarding it would re-trigger full
  // recency promotion on reload).
  actions.hydrateChrome({
    groupBy: 'workspace',
    orderBy: 'updated',
    groupExpansion: { 'exp:repo-b': true },
    sessionOrder: { 'ws-1': ['s-1', 's-2'] },
  })
  const hydrated = instance.getSnapshot()
  assert.equal(hydrated.groupBy, 'workspace')
  assert.equal(hydrated.orderBy, 'updated')
  assert.deepEqual(hydrated.groupExpansion, { 'exp:repo-b': true })
  assert.deepEqual(hydrated.sessionOrderByAccount['ws-1'], ['s-1', 's-2'])
  assert.deepEqual(hydrated.sessionUpdatedAtByAccount['ws-1'], { 's-1': 5, 's-2': 9 })
  assert.deepEqual(hydrated.sessionUpdatedAtByAccount[FLAT_SESSION_ORDER_KEY], { 's-3': 7 })

  // Retain cleanup: stale accounts drop everywhere; live ones survive. The
  // flat-list account is re-synced by the browser whenever the flat list
  // renders, so its absence right after a chrome hydrate is expected.
  actions.retainAccountKeys(['ws-1', FLAT_SESSION_ORDER_KEY, 'exp:repo-b'])
  const retained = instance.getSnapshot()
  assert.deepEqual(Object.keys(retained.groupExpansion), ['exp:repo-b'])
  assert.deepEqual(Object.keys(retained.sessionOrderByAccount), ['ws-1'])
  assert.ok(retained.sessionUpdatedAtByAccount['exp:stale'] === undefined)

  // Grouping hydration sanitizes icon preferences and adopts identity fields.
  // The invalid builtin name is data a stored slice may carry; the sanitizer
  // drops it, so the argument is typed as the wire shape it round-trips.
  actions.hydrateGrouping({
    activeTab: 'g1',
    groupIds: ['g1'],
    groupLabels: { g1: 'Team' },
    projectAlias: { '/repo': 'Repo' },
    projectIconOverrides: {
      '/repo': { kind: 'builtin', name: 'git' },
      '/bad': { kind: 'builtin', name: 'nope' },
    } as unknown as Record<string, ProjectIconPreference>,
  })
  const grouped = instance.getSnapshot()
  assert.equal(grouped.activeTab, 'g1')
  assert.deepEqual(grouped.projectIconOverrides, { '/repo': { kind: 'builtin', name: 'git' } })

  // Every action produced exactly one subscriber pass.
  assert.equal(states.length, 9)
  unsubscribe()
})

/* ── G1b: chrome channel round-trip through persistVia ─────────────────── */

test('left_rail_view chrome round-trips through the persistVia channel', async () => {
  const transport = new FakeCapabilities()
  transport.tables.set('left_rail_view', {
    groupBy: 'flat',
    orderBy: 'manual',
    groupExpansion: { 'exp:a': true },
    sessionOrder: { [FLAT_SESSION_ORDER_KEY]: ['s-9', 's-8'] },
    junk: 'dropped-by-sanitizer',
  })
  await withTransport(transport, async () => {
    const loaded = await loadLeftRailChrome()
    assert.deepEqual(loaded, {
      groupBy: 'flat',
      orderBy: 'manual',
      groupExpansion: { 'exp:a': true },
      sessionOrder: { [FLAT_SESSION_ORDER_KEY]: ['s-9', 's-8'] },
    })

    saveLeftRailChrome({
      groupBy: 'workspace',
      orderBy: 'updated',
      groupExpansion: {},
      sessionOrder: {},
    })
    await flushLeftRailChrome()

    const puts = transport.calls('ui-chrome.put')
    assert.equal(puts.length, 1)
    assert.equal(puts[0]?.body.table, UI_CHROME_TABLES.leftRailView)
    assert.deepEqual(puts[0]?.body.value, {
      groupBy: 'workspace',
      orderBy: 'updated',
      groupExpansion: {},
      sessionOrder: {},
    })
  })
})

/* ── G1c: strict hydration + no save-back on transport failure ─────────── */

test('failed chrome hydration stays strict and emits no save-back', async () => {
  const transport = new FakeCapabilities()
  await withTransport(transport, async () => {
    // An empty table reads as defaults WITHOUT writing anything back.
    const empty = await loadLeftRailChrome()
    assert.deepEqual(empty, defaultLeftRailViewChrome())
    assert.equal(transport.calls('ui-chrome.put').length, 0)
  })

  const down = new FakeCapabilities()
  down.outage = new Error('host unreachable')
  await withTransport(down, async () => {
    // Strict read: transport failure THROWS instead of resolving defaults.
    await assert.rejects(loadLeftRailChrome(), /host unreachable/)
    // The consumer's hydrate gate stays off, so a paused surface only ever
    // drains an empty queue: no defaults are persisted over the host record.
    await flushLeftRailChrome()
    assert.equal(down.calls('ui-chrome.put').length, 0)

    // Once the transport recovers, the SAME explicit save path works again —
    // the pause was the gate, not a wedged channel.
    down.outage = null
    saveLeftRailChrome(defaultLeftRailViewChrome())
    await flushLeftRailChrome()
    assert.equal(down.calls('ui-chrome.put').length, 1)
  })
})

/* ── G1d: settings profile channel (deletion-capable path ops) ─────────── */

test('profile saves diff to deletion-capable path ops under CAS', async () => {
  const transport = new FakeCapabilities()
  transport.namespaces.set(LEFT_RAIL_SETTINGS_NS, {
    section: {
      version: 1,
      worktreeDir: '/tmp/worktrees',
      projectIconOverrides: { '/repo': { kind: 'builtin', name: 'git' } },
    },
    revision: 4,
  })
  await withTransport(transport, async () => {
    const loaded = await loadLeftRailSettings()
    assert.equal(loaded.revision, 4)
    assert.equal(loaded.value.worktreeDir, '/tmp/worktrees')

    // Clearing the directory override deletes the key; untouched keys
    // (projectIconOverrides) produce no op at all.
    const { worktreeDir: _dropped, ...next } = loaded.value
    void _dropped
    const saved = await saveLeftRailSettings(next, loaded.revision)
    assert.equal(saved.revision, 5)

    const mutates = transport.calls('settings.mutate')
    assert.equal(mutates.length, 1)
    assert.equal(mutates[0]?.body.ns, LEFT_RAIL_SETTINGS_NS)
    assert.deepEqual(mutates[0]?.body.ops, [{ op: 'unset', path: ['worktreeDir'] }])
    assert.equal(mutates[0]?.body.expectedRevision, 4)

    // Deletion survives a reload (the regression the merge-only path had).
    const reloaded = await loadLeftRailSettings()
    assert.equal(reloaded.value.worktreeDir, undefined)
    assert.deepEqual(reloaded.value.projectIconOverrides, { '/repo': { kind: 'builtin', name: 'git' } })
    assert.equal(reloaded.value.version, 1)

    // A no-op save skips the wire entirely.
    const before = transport.calls('settings.mutate').length
    await saveLeftRailSettings(reloaded.value, reloaded.revision)
    assert.equal(transport.calls('settings.mutate').length, before)
  })
})

test('diffSettingsOps expresses additions, changes, and removals', () => {
  // The extra keys are wire shapes a stored legacy slice may carry; the diff
  // treats unknown top-level keys like any other.
  const base = { activeTab: 'old', stale: 'key' } as Partial<LeftRailSettings> & Record<string, unknown>
  const next = { activeTab: 'new', brand: 'new' } as Partial<LeftRailSettings> & Record<string, unknown>
  const ops = diffSettingsOps(base as LeftRailSettings, next as LeftRailSettings)
  // Equal keys produce no op; removed keys unset; new/changed keys set.
  // Ops follow the key union order: base keys first, then added ones.
  assert.deepEqual(ops, [
    { op: 'set', path: ['activeTab'], value: 'new' },
    { op: 'unset', path: ['stale'] },
    { op: 'set', path: ['brand'], value: 'new' },
  ])
})

test('a lost CAS race self-heals over the latest slice without reverting the winner', async () => {
  const transport = new FakeCapabilities()
  transport.namespaces.set(LEFT_RAIL_SETTINGS_NS, {
    section: { version: 1, activeTab: '__default__' },
    revision: 2,
  })
  // While the browser's first write is in flight, the settings page stores
  // its own preference; the browser's stale-CAS write must lose once and then
  // land over the merged base without deleting nestWorktrees.
  transport.conflictOnceWith = { version: 1, nestWorktrees: false }
  await withTransport(transport, async () => {
    const loaded = await loadLeftRailSettings()
    const saved = await withSettingsCas(loaded.value, loaded.revision, base => ({
      ...base,
      activeTab: 'tab-x',
    }))
    assert.equal(saved.value.activeTab, 'tab-x')
    const final = transport.namespace(LEFT_RAIL_SETTINGS_NS)
    assert.equal(final.activeTab, 'tab-x')
    // The concurrent writer's key survives the healed retry.
    assert.equal(final.nestWorktrees, false)
    assert.equal(transport.calls('settings.mutate').length, 2)
  })
})

/* ── G1e: profile writes ride the persistVia pump ──────────────────────── */

test('profile persistence routes through the persistVia settings pump', async () => {
  const transport = new FakeCapabilities()
  const failures: unknown[] = []
  await withTransport(transport, async () => {
    const pump = startLeftRailSettingsPersistence({
      onWriteFailed: error => { failures.push(error) },
    })
    try {
      pump.write({ activeTab: 'tab-pump' })
      await pump.flush()
      const mutates = transport.calls('settings.mutate')
      assert.equal(mutates.length, 1)
      assert.equal(mutates[0]?.body.ns, LEFT_RAIL_SETTINGS_NS)
      assert.deepEqual(transport.namespace(LEFT_RAIL_SETTINGS_NS).activeTab, 'tab-pump')
      assert.equal(failures.length, 0)

      // Transport failure surfaces through the pump callback, never silently.
      transport.outage = new Error('gone')
      pump.write({ activeTab: 'tab-lost' })
      await pump.flush()
      assert.equal(failures.length, 1)
    } finally {
      pump.stop()
    }
  })
})

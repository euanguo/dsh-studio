import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  loadLeftRailSettings,
  saveLeftRailSettings,
} from '../plugins/desktop-left-rail/src/client/left-rail-settings.ts'
import {
  migrateLegacyLeftRailSlice,
  type LeftRailMigrationSeam,
} from '../plugins/capabilities/src/left-rail-settings-migration.ts'
import {
  LEFT_RAIL_SETTINGS_NS,
  LEFT_RAIL_SETTINGS_VERSION,
} from '@dsh-studio/shared/left-rail-preferences'
import { SIDEBAR_PREFS_NS } from '@dsh-studio/shared/prefs-shared'

/**
 * A minimal in-memory settings seam mirroring dsh-settings semantics
 * (mergeLayers / replace / path-ops mutate + a per-namespace revision) so the
 * tests faithfully exercise the exact write behaviors the host routes call.
 */
class MemorySettingsSeam {
  readonly document = new Map<string, Record<string, unknown>>()
  readonly revisions = new Map<string, number>()

  constructor(initial?: Record<string, Record<string, unknown>>) {
    for (const [ns, section] of Object.entries(initial ?? {})) {
      this.document.set(ns, structuredClone(section))
      this.revisions.set(ns, 1)
    }
  }

  section(ns: string): Record<string, unknown> {
    return this.document.get(ns) ?? {}
  }

  describe(ns: string): { user?: unknown; revision?: number } {
    const section = this.document.get(ns)
    if (section === undefined) return {}
    return { user: structuredClone(section), revision: this.revisions.get(ns) ?? 0 }
  }

  mergeLayers(under: Record<string, unknown>, over: Record<string, unknown>): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...under }
    for (const [key, value] of Object.entries(over)) {
      merged[key] = typeof merged[key] === 'object' && merged[key] !== null
        && !Array.isArray(merged[key])
        && typeof value === 'object' && value !== null && !Array.isArray(value)
        ? this.mergeLayers(merged[key] as Record<string, unknown>, value as Record<string, unknown>)
        : value
    }
    return merged
  }

  update(ns: string, patch: Record<string, unknown>): void {
    const next = this.mergeLayers(this.section(ns), patch)
    this.document.set(ns, next)
    this.revisions.set(ns, (this.revisions.get(ns) ?? 0) + 1)
  }

  replace(ns: string, section: Record<string, unknown>): void {
    this.document.set(ns, structuredClone(section))
    this.revisions.set(ns, (this.revisions.get(ns) ?? 0) + 1)
  }

  mutate(ns: string, ops: ReadonlyArray<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>): void {
    const next = structuredClone(this.section(ns))
    for (const op of ops) {
      this.applyPathOp(next, op)
    }
    this.document.set(ns, next)
    this.revisions.set(ns, (this.revisions.get(ns) ?? 0) + 1)
  }

  private applyPathOp(section: Record<string, unknown>, op: { op: 'set' | 'unset'; path: string[]; value?: unknown }): void {
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
    this.applyPathOp(section[head] as Record<string, unknown>, { ...op, path: rest })
  }

  /** The route seam the host migration code sees. */
  migrationSeam(): LeftRailMigrationSeam {
    return {
      describe: (ns) => this.describe(ns),
      replace: async (ns, section) => { this.replace(ns, section as Record<string, unknown>) },
      mutate: async (ns, ops) => { this.mutate(ns, ops) },
    }
  }
}

interface Request {
  url: string
  method: string
  body: string
}

/**
 * A fake `/capabilities/api` transport backed by the memory seam, wired the way
 * the host routes are (namespace-aware settings.get / deletion-capable
 * settings.mutate; default ns falls back to the sidebar prefs namespace).
 */
function installFakeSidebarApi(seam: MemorySettingsSeam): void {
  const calls: Request[] = []
  const handler = async (url: string, init?: { method?: string; body?: string }): Promise<{
    ok: boolean
    json: () => Promise<{ ok: boolean; value?: unknown }>
    status: number
  }> => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ?? '' })
    const method = url.slice('/capabilities/api/'.length)
    const payload = JSON.parse(init?.body ?? '{}') as Record<string, unknown>
    const rawNs = typeof payload.ns === 'string' && payload.ns !== '' ? payload.ns : SIDEBAR_PREFS_NS
    let value: unknown
    if (method === 'settings.get') {
      value = { value: seam.section(rawNs), revision: seam.revisions.get(rawNs) ?? 0 }
    } else if (method === 'settings.mutate') {
      seam.mutate(rawNs, payload.ops as ReadonlyArray<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>)
      value = { value: seam.section(rawNs), revision: seam.revisions.get(rawNs) ?? 0 }
    } else {
      throw new Error(`unexpected method ${method}`)
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, value }),
    }
  }
  globalThis.fetch = handler as unknown as typeof fetch
  // Expose the captured wire calls for assertions.
  ;(globalThis as unknown as { __sidebarCalls: Request[] }).__sidebarCalls = calls
}

function sidebarCalls(): Request[] {
  return (globalThis as unknown as { __sidebarCalls: Request[] }).__sidebarCalls
}

const REPO = '/work/repo'

test('left-rail slice written via the deletion-capable mutate channel round-trips through a reload, including deletion', async () => {
  const seam = new MemorySettingsSeam()
  installFakeSidebarApi(seam)

  // Seed a stored slice the way a previous run left it (git icon override).
  seam.replace(LEFT_RAIL_SETTINGS_NS, {
    version: LEFT_RAIL_SETTINGS_VERSION,
    activeTab: '__default__',
    projectGroup: { [REPO]: 'group-a' },
    groupIds: ['group-a'],
    groupLabels: { 'group-a': 'A' },
    projectAlias: { [REPO]: 'repo' },
    worktreeAlias: { [REPO]: 'wt' },
    projectIconOverrides: { [REPO]: { kind: 'builtin', name: 'git' } },
  })

  // First read: the hydrated slice still carries the git override.
  const before = await loadLeftRailSettings()
  assert.deepEqual(before.value.projectIconOverrides, { [REPO]: { kind: 'builtin', name: 'git' } })

  // The user switches the icon to auto: the store deletes the override, so
  // the persisted slice now carries an empty overrides map.
  await saveLeftRailSettings({ ...before.value, projectIconOverrides: {} }, before.revision)

  // Assert the wire used the deletion-capable channel for the LEFT-RAIL ns.
  const write = sidebarCalls().find(call => call.url === '/capabilities/api/settings.mutate')
  assert.ok(write !== undefined, 'save used the deletion-capable settings.mutate channel')
  const writeNs = JSON.parse(write.body).ns
  assert.equal(writeNs, LEFT_RAIL_SETTINGS_NS)

  // Reload (fresh read, e.g. after the desktop restarts): the override must
  // NOT resurrect. This is the exact regression the merge-only path had.
  const after = await loadLeftRailSettings()
  assert.deepEqual(after.value.projectIconOverrides, {})
  assert.ok('projectIconOverrides' in after.value)
})

test('left-rail slice merges additions without dropping non-deleted keys on reload', async () => {
  const seam = new MemorySettingsSeam()
  installFakeSidebarApi(seam)

  await saveLeftRailSettings({
    activeTab: 'tab-a',
    projectGroup: { [REPO]: 'group-a' },
    projectIconOverrides: { [REPO]: { kind: 'builtin', name: 'folder' } },
  }, 0)

  const written = seam.section(LEFT_RAIL_SETTINGS_NS)
  assert.equal(written.version, LEFT_RAIL_SETTINGS_VERSION)
  assert.equal(written.activeTab, 'tab-a')
  assert.deepEqual(written.projectIconOverrides, { [REPO]: { kind: 'builtin', name: 'folder' } })
})

test('legacy slice migrates out of the sidebar namespace into dsh-studio.left-rail', async () => {
  const seam = new MemorySettingsSeam({
    [SIDEBAR_PREFS_NS]: {
      terminalFontSize: 12,
      activeTab: '__default__',
      projectGroup: { [REPO]: 'group-a' },
      projectIconOverrides: { [REPO]: { kind: 'builtin', name: 'git' } },
    },
  })
  const migrated = await migrateLegacyLeftRailSlice(seam.migrationSeam())
  assert.equal(migrated, true)

  const target = seam.section(LEFT_RAIL_SETTINGS_NS)
  assert.equal(target.version, LEFT_RAIL_SETTINGS_VERSION)
  assert.equal(target.activeTab, '__default__')
  assert.deepEqual(target.projectIconOverrides, { [REPO]: { kind: 'builtin', name: 'git' } })

  // The sidebar section keeps its own fields, loses the left-rail keys.
  const sidebar = seam.section(SIDEBAR_PREFS_NS)
  assert.equal(sidebar.terminalFontSize, 12)
  assert.equal('activeTab' in sidebar, false)
  assert.equal('projectIconOverrides' in sidebar, false)
  assert.equal('projectGroup' in sidebar, false)

  // Idempotent: a second run migrates nothing and touches nothing.
  const again = await migrateLegacyLeftRailSlice(seam.migrationSeam())
  assert.equal(again, false)
})

test('migration never clobbers an existing dsh-studio.left-rail slice', async () => {
  const seam = new MemorySettingsSeam({
    [SIDEBAR_PREFS_NS]: {
      activeTab: '__default__',
      projectIconOverrides: { [REPO]: { kind: 'builtin', name: 'git' } },
    },
    [LEFT_RAIL_SETTINGS_NS]: {
      version: LEFT_RAIL_SETTINGS_VERSION,
      projectIconOverrides: { [REPO]: { kind: 'builtin', name: 'web' } },
    },
  })
  const migrated = await migrateLegacyLeftRailSlice(seam.migrationSeam())
  assert.equal(migrated, false)
  // The fresher target is untouched (web over git).
  assert.deepEqual(seam.section(LEFT_RAIL_SETTINGS_NS).projectIconOverrides,
    { [REPO]: { kind: 'builtin', name: 'web' } })
})

test('migration no-ops when no legacy left-rail keys ride in the sidebar section', async () => {
  const seam = new MemorySettingsSeam({
    [SIDEBAR_PREFS_NS]: { terminalFontSize: 12 },
  })
  const migrated = await migrateLegacyLeftRailSlice(seam.migrationSeam())
  assert.equal(migrated, false)
  assert.equal(seam.document.has(LEFT_RAIL_SETTINGS_NS), false)
})

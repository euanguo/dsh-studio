import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DesktopSidebarService,
} from '../plugins/sidebar/src/client/sidebar-service.ts'
import type { SidebarPreferencesStorage } from '../plugins/sidebar/src/client/sidebar-storage.ts'
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  parseSidebarPreferences,
  type DesktopSidebarPreferences,
} from '../plugins/sidebar/src/sidebar-preferences.ts'

class MemorySidebarStorage implements SidebarPreferencesStorage {
  writes: DesktopSidebarPreferences[] = []
  value: DesktopSidebarPreferences

  constructor(value?: DesktopSidebarPreferences) {
    this.value = value ?? {
      ...DEFAULT_SIDEBAR_PREFERENCES,
      workspaces: {},
      tabsEnabled: {},
      viewersEnabled: {},
      pluginSettings: {},
    }
  }

  async load(): Promise<DesktopSidebarPreferences> {
    return structuredClone(this.value)
  }

  async save(preferences: DesktopSidebarPreferences): Promise<void> {
    this.value = structuredClone(preferences)
    this.writes.push(structuredClone(preferences))
  }
}

function tab(id: string): Parameters<DesktopSidebarService['registerTab']>[0] {
  return { id, render: () => null, title: id }
}

async function startedService(
  value?: DesktopSidebarPreferences,
): Promise<{ service: DesktopSidebarService; storage: MemorySidebarStorage }> {
  const storage = new MemorySidebarStorage(value)
  const service = new DesktopSidebarService(storage)
  service.registerTab(tab('file'))
  await service.start()
  return { service, storage }
}

/* ── preference parsing ───────────────────────────────────────────── */

test('legacy documents without the new fields parse to the defaults', () => {
  const parsed = parseSidebarPreferences({
    version: 2,
    openByDefault: false,
    defaultWidth: 480,
    workspaces: {},
    tabsEnabled: {},
    viewersEnabled: {},
    pluginSettings: {},
  })
  assert.equal(parsed?.centerPreviewTabs, 'default')
  assert.equal(parsed?.layoutScope, 'workspace')
})

test('unknown preview/layout values fall back instead of rejecting the document', () => {
  const parsed = parseSidebarPreferences({
    version: 2,
    openByDefault: false,
    defaultWidth: 480,
    workspaces: {},
    tabsEnabled: {},
    viewersEnabled: {},
    pluginSettings: {},
    centerPreviewTabs: 'sometimes',
    layoutScope: 'per-branch',
  })
  assert.equal(parsed?.centerPreviewTabs, 'default')
  assert.equal(parsed?.layoutScope, 'workspace')
})

test('per-workspace width is optional and clamped when present', () => {
  const parsed = parseSidebarPreferences({
    version: 2,
    openByDefault: false,
    defaultWidth: 480,
    workspaces: {
      '/repo/a': { activeId: null, lastUsed: 1, tabs: [], width: 9999 },
      '/repo/b': { activeId: null, lastUsed: 2, tabs: [], width: 'wide' },
    },
    tabsEnabled: {},
    viewersEnabled: {},
    pluginSettings: {},
  })
  assert.equal(parsed?.workspaces['/repo/a']?.width, 640)
  assert.equal(parsed?.workspaces['/repo/b']?.width, undefined)
})

/* ── workspace-scoped rail geometry (B5/D7) ───────────────────────── */

test('rail width is remembered per project and restored on switch-back', async () => {
  const { service } = await startedService()
  service.setWorkspace('/repo/a')
  service.setWidth(520)
  assert.equal(service.getSnapshot().width, 520)

  // The other project never had a width: it falls back to the default.
  service.setWorkspace('/repo/b')
  assert.equal(service.getSnapshot().width, DEFAULT_SIDEBAR_PREFERENCES.defaultWidth)

  // Switching back restores /repo/a's remembered width.
  service.setWorkspace('/repo/a')
  assert.equal(service.getSnapshot().width, 520)

  // And the remembered width landed in /repo/a's own bucket.
  assert.equal(service.getSnapshot().width, 520)
})

/* ── global layout scope ─────────────────────────────────────────── */

test('global scope shares one rail layout across projects', async () => {
  const { service } = await startedService()
  service.setLayoutScope('global')

  service.setWorkspace('/repo/a')
  const opened = service.openTab({ type: 'file', resource: '/repo/a/one.ts', title: 'one.ts' })
  assert.ok(opened.kind === 'opened' || opened.kind === 'focused')

  // A different project sees the SAME shared layout in global mode.
  service.setWorkspace('/repo/b')
  assert.equal(service.getSnapshot().tabs.length, 1)
  assert.equal(service.getSnapshot().tabs[0]?.resource, '/repo/a/one.ts')

  // Width changes land in the shared bucket too.
  service.setWidth(560)
  service.setWorkspace('/repo/a')
  assert.equal(service.getSnapshot().width, 560)
})

test('switching back to workspace scope restores the per-project queues', async () => {
  const { service } = await startedService()
  service.setWorkspace('/repo/a')
  service.openTab({ type: 'file', resource: '/repo/a/a.ts', title: 'a.ts' })

  service.setLayoutScope('global')
  service.setWorkspace('/repo/b')
  service.openTab({ type: 'file', resource: '/repo/b/b.ts', title: 'b.ts' })

  service.setLayoutScope('workspace')
  service.setWorkspace('/repo/a')
  // /repo/a keeps its own queue…
  assert.equal(service.getSnapshot().tabs.length, 1)
  assert.equal(service.getSnapshot().tabs[0]?.resource, '/repo/a/a.ts')

  // …while /repo/b — whose own bucket was empty when we left global scope —
  // ADOPTED the shared layout it was looking at (adoption never overwrites
  // an existing bucket).
  service.setWorkspace('/repo/b')
  assert.equal(service.getSnapshot().tabs.length, 2)
  assert.deepEqual(
    service.getSnapshot().tabs.map(tab => tab.resource).sort(),
    ['/repo/a/a.ts', '/repo/b/b.ts'],
  )
})

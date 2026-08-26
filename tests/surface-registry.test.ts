/**
 * SurfaceRegistry unification oracle (kernel-refactor leaf-1.3).
 *
 * Behavioral coverage for the ONE descriptor table: a single
 * `SidebarSurfaceDescriptor` simultaneously drives
 *   - the right-rail chip (menu catalog order / availability),
 *   - the center workbench (renderer dispatch through `renderSurface`),
 *   - file-viewer matching (`matchViewer` by detect + exts, enablement-gated)
 * and the legacy field semantics survive the merge: rail `order` sorts the
 * menu, `single` dedupes opens, the `available` predicate blocks with a
 * reason, declarative `settings` stay reachable per aspect.
 *
 * The tests execute the real service; no source-text assertions.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DesktopSidebarService } from '../plugins/sidebar/src/client/sidebar-service.ts'
import {
  sidebarDescriptorSettings,
  sidebarDescriptorTitle,
  tabAvailability,
} from '../plugins/sidebar/src/client/contract.ts'
import type { SidebarSurfaceDescriptor } from '../plugins/sidebar/src/client/contract.ts'
import type { SidebarPreferencesStorage } from '../plugins/sidebar/src/client/sidebar-storage.ts'
import { createSurfaceRegistry } from '../plugins/workbench/src/registry.ts'
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  type DesktopSidebarPreferences,
} from '../plugins/sidebar/src/sidebar-preferences.ts'

class MemorySidebarStorage implements SidebarPreferencesStorage {
  value: DesktopSidebarPreferences

  constructor() {
    this.value = {
      ...DEFAULT_SIDEBAR_PREFERENCES,
      workspaces: {},
      pluginSettings: {},
    }
  }

  async load(): Promise<DesktopSidebarPreferences> {
    return structuredClone(this.value)
  }

  async save(preferences: DesktopSidebarPreferences): Promise<void> {
    this.value = structuredClone(preferences)
  }
}

/** One descriptor declaring ALL THREE aspects at once. */
function fullSurface(kind: string, overrides: Partial<SidebarSurfaceDescriptor> = {}): SidebarSurfaceDescriptor {
  return {
    kind,
    rail: {
      title: () => kind,
      order: 10,
      render: () => null,
      settings: { toggles: [{ key: 'terminalFontSize', title: 'size', type: 'number' }] },
      single: true,
      available: scope => scope?.cwd !== '',
    },
    center: { render: surface => surface.kind === kind ? `center:${kind}` : null },
    viewer: {
      exts: [kind === 'file' ? 'txt' : 'dat'],
      fetchStrategy: 'fsRead',
      priority: 5,
      title: `${kind} viewer`,
    },
    scopeNeed: null,
    previewable: true,
    focusPolicy: 'never',
    ...overrides,
  }
}

async function startedService(registry = createSurfaceRegistry()): Promise<DesktopSidebarService> {
  const sidebar = new DesktopSidebarService(new MemorySidebarStorage(), undefined, registry)
  await sidebar.start()
  return sidebar
}

test('ONE descriptor drives the sidebar and kernel registries', async () => {
  const registry = createSurfaceRegistry()
  const sidebar = await startedService(registry)
  const descriptor = fullSurface('file')
  const remove = sidebar.register(descriptor)

  // The single sidebar registration projects the routing facts into the
  // React-free kernel table; no second pipeline descriptor is authored.
  assert.deepEqual(registry.resolve('file'), {
    kind: 'file',
    rail: { order: 10, single: true, dedupeKey: 'file' },
    center: {},
    viewer: { exts: ['txt'], priority: 5 },
    scopeNeed: null,
    previewable: true,
    focusPolicy: 'never',
  })

  // Rail chip: the same object backs the menu catalog…
  assert.ok(sidebar.getTabs().includes(descriptor))
  // …the center workbench renderer…
  assert.equal(sidebar.renderSurface({
    id: 'file:/w/a',
    kind: 'file',
    cwd: '/w',
    filePath: '/w/a',
    title: 'a',
    closable: true,
    isPreview: true,
  }), 'center:file')
  // …and the file-viewer match — one registration, three behaviors.
  assert.equal(sidebar.matchViewer('readme.TXT')?.kind, 'file')

  // Unregistering the ONE descriptor retires all three behaviors together.
  remove()
  assert.equal(sidebar.getTab('file'), undefined)
  assert.equal(sidebar.getTabs().includes(descriptor), false)
  assert.equal(sidebar.matchViewer('readme.txt'), undefined)
  assert.equal(registry.resolve('file'), undefined)
})

test('rail order semantics survive the merge (ascending + menu default)', async () => {
  const sidebar = await startedService()
  sidebar.register(fullSurface('late', {
    rail: { title: 'late', order: 900, render: () => null },
    previewable: false,
  }))
  sidebar.register({ ...fullSurface('early'), previewable: false })
  sidebar.register({
    kind: 'default-order',
    rail: { title: 'default-order', render: () => null },
    scopeNeed: null,
    previewable: false,
    focusPolicy: 'never',
  })
  assert.deepEqual(
    sidebar.getTabs().map(descriptor => descriptor.kind),
    ['early', 'default-order', 'late'],
  )
})

test('single-instance dedupe still focuses the existing tab', async () => {
  const sidebar = await startedService()
  sidebar.setWorkspace('/work/repo')
  sidebar.register(fullSurface('inspector'))
  const first = sidebar.openTab({ type: 'inspector' })
  assert.equal(first.kind, 'opened')
  const second = sidebar.openTab({ id: 'another', type: 'inspector' })
  assert.equal(second.kind, 'focused')
  if (second.kind === 'focused') assert.equal(second.tab.id, first.kind === 'opened' ? first.tab.id : '')
  assert.equal(
    sidebar.getSnapshot().tabs.filter(tab => tab.type === 'inspector').length,
    1,
  )
})

test('the rail available predicate gates every entry point with one answer', async () => {
  const sidebar = await startedService()
  const descriptor = fullSurface('gated', {
    rail: {
      title: 'gated',
      render: () => null,
      available: scope => scope !== null && scope.cwd === '/work/repo',
    },
    previewable: false,
  })
  sidebar.register(descriptor)

  // The shared gate (menu rows use it directly)…
  const blocked = tabAvailability(descriptor, { cwd: '/other' }, sidebar.getSnapshot(), true)
  assert.deepEqual(blocked, { ok: false, reason: 'unavailable' })
  // …and openTab agree.
  const result = sidebar.openTab({ type: 'gated' }, { cwd: '/work/repo' })
  assert.equal(result.kind, 'opened')
})

test('declarative settings stay reachable per aspect', async () => {
  const sidebar = await startedService()
  sidebar.register(fullSurface('file'))
  sidebar.register({
    kind: 'viewer-only',
    viewer: {
      exts: ['csv'],
      fetchStrategy: 'fsRead',
      settings: { pluginToggles: [{ key: 'pageSize', title: 'page size', type: 'number' }] },
      title: 'CSV',
    },
    scopeNeed: null,
    previewable: false,
    focusPolicy: 'never',
  })

  const file = sidebar.getTab('file')!
  // Rail settings win over the viewer declaration on the same descriptor.
  assert.equal(sidebarDescriptorSettings(file), file.rail!.settings!)
  const title = sidebarDescriptorTitle(file)
  assert.equal(typeof title === 'function' ? title() : title, 'file')

  const csv = sidebar.getTab('viewer-only')!
  assert.deepEqual(sidebarDescriptorSettings(csv)?.pluginToggles?.[0]?.key, 'pageSize')
  assert.equal(sidebarDescriptorTitle(csv), 'CSV')
})

test('registration discipline: duplicate kinds and invalid descriptors throw', async () => {
  const sidebar = await startedService()
  sidebar.register(fullSurface('file'))
  // A kind has exactly one owner.
  assert.throws(() => sidebar.register(fullSurface('file')), /duplicate surface/)
  // Non-empty kind.
  assert.throws(() => sidebar.register(fullSurface('  ')), /non-empty kind/)
  // At least one aspect must be declared.
  assert.throws(
    () => sidebar.register({
      kind: 'bare',
      scopeNeed: null,
      previewable: false,
      focusPolicy: 'never',
    }),
    /must declare/,
  )
  // Kernel parity: only center-class surfaces can be previews.
  assert.throws(
    () => sidebar.register({
      kind: 'rail-preview',
      rail: { title: 'rail-preview', render: () => null },
      scopeNeed: null,
      previewable: true,
      focusPolicy: 'never',
    }),
    /previewable but declares no center spec/,
  )
})

test('viewer matching stays enablement-gated and sniff-first', async () => {
  const sidebar = await startedService()
  sidebar.register(viewerRegistration('binary', {
    detect: (_path, head) => head.includes(0),
    exts: [],
    fetchStrategy: 'binary-download',
    priority: 100,
  }))
  sidebar.register(viewerRegistration('text', { exts: [], fetchStrategy: 'fsRead', priority: -100 }))

  // Sniff wins over the catch-all…
  assert.equal(sidebar.matchViewer('blob.data', new Uint8Array([1, 0, 2]))?.kind, 'binary')
  // …and disabling the winner falls through to the next claimant.
  sidebar.setViewerEnabled('binary', false)
  assert.equal(sidebar.matchViewer('blob.data', new Uint8Array([1, 0, 2]))?.kind, 'text')
})

function viewerRegistration(
  kind: string,
  spec: Partial<NonNullable<SidebarSurfaceDescriptor['viewer']>> & Pick<NonNullable<SidebarSurfaceDescriptor['viewer']>, 'exts' | 'fetchStrategy'>,
): SidebarSurfaceDescriptor {
  return { kind, viewer: spec, scopeNeed: null, previewable: false, focusPolicy: 'never' }
}

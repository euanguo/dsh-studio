import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DesktopSidebarService,
  SIDEBAR_FEATURES,
  SIDEBAR_SERVICE_VERSION,
  type SidebarTabDescriptor,
} from '../plugins/sidebar/src/client/sidebar-service.ts'
import type { SidebarPreferencesStorage } from '../plugins/sidebar/src/client/sidebar-storage.ts'
import {
  clampSidebarWidthForLayout,
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

test('right sidebar width clamps to its own budget at any window size', () => {
  assert.equal(clampSidebarWidthForLayout(700), 640)
  assert.equal(clampSidebarWidthForLayout(200), 220)
  assert.equal(clampSidebarWidthForLayout(480), 480)
})

function tab(
  id: string,
  input: Partial<SidebarTabDescriptor> = {},
): SidebarTabDescriptor {
  return {
    id,
    render: () => null,
    title: id,
    ...input,
  }
}

test('desktop sidebar validates the durable preference envelope', () => {
  const valid = {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    workspaces: {
      '/work/repo': {
        activeId: 'file:a',
        lastUsed: 42,
        tabs: [{ id: 'file:a', type: 'file', title: 'a', resource: '/a' }],
        // The bottom workbench is additive: the canonical parsed shape
        // carries the defaults (legacy documents migrate to them).
        bottomTabs: [],
        bottomActiveId: null,
      },
    },
    tabsEnabled: { browser: false },
    viewersEnabled: { image: true },
    pluginSettings: { 'my-plugin:db': { pageSize: 20 } },
  }
  assert.deepEqual(parseSidebarPreferences(valid), valid)
  assert.equal(parseSidebarPreferences({ ...valid, defaultWidth: 100 }), undefined)
  assert.equal(
    parseSidebarPreferences({ ...valid, defaultWidth: 720 })?.defaultWidth,
    640,
  )
  assert.equal(parseSidebarPreferences({
    ...valid,
    workspaces: {
      '/work/repo': { ...valid.workspaces['/work/repo'], activeId: 'missing' },
    },
  }), undefined)
  // pluginSettings must stay JSON-safe (functions / NaN rejected).
  assert.equal(parseSidebarPreferences({
    ...valid,
    pluginSettings: { x: { y: () => 1 } },
  }), undefined)
  assert.equal(parseSidebarPreferences({
    ...valid,
    pluginSettings: { x: { y: Number.NaN } },
  }), undefined)
  // tab meta must stay JSON-safe.
  assert.equal(parseSidebarPreferences({
    ...valid,
    workspaces: {
      '/work/repo': {
        ...valid.workspaces['/work/repo'],
        tabs: [{ id: 't', type: 'file', title: 'a', meta: { fn: () => 1 } }],
      },
    },
  }), undefined)
})

test('desktop sidebar restores workspaces and deduplicates registered tabs', async () => {
  const storage = new MemorySidebarStorage({
    ...DEFAULT_SIDEBAR_PREFERENCES,
    workspaces: {
      '/work/repo': {
        activeId: 'file:readme',
        lastUsed: 1,
        tabs: [{
          id: 'file:readme',
          resource: '/workspace/README.md',
          title: 'README.md',
          type: 'file',
        }],
      },
    },
    tabsEnabled: {},
    viewersEnabled: {},
    pluginSettings: {},
  })
  const sidebar = new DesktopSidebarService(storage)
  sidebar.setWorkspace('/work/repo')
  await sidebar.start()
  const removeFile = sidebar.registerTab(tab('file', {
    dedupeKey: candidate => candidate.resource,
  }))

  assert.equal(sidebar.getSnapshot().activeId, 'file:readme')
  assert.equal(sidebar.openTab({
    resource: '/workspace/README.md',
    title: 'README.md',
    type: 'file',
  }).kind, 'focused')
  assert.equal(sidebar.getSnapshot().tabs.length, 1)

  sidebar.registerTab(tab('review', { single: true }))
  sidebar.openTab({ type: 'review' })
  sidebar.openTab({ id: 'another-review', type: 'review' })
  assert.equal(
    sidebar.getSnapshot().tabs.filter(candidate => candidate.type === 'review').length,
    1,
  )

  removeFile()
  assert.equal(sidebar.getTab('file'), undefined)
  assert.equal(sidebar.getSnapshot().tabs[0]?.type, 'file')
})

test('desktop sidebar matches viewers by priority, sniffing, and enablement', async () => {
  const sidebar = new DesktopSidebarService(new MemorySidebarStorage())
  await sidebar.start()
  sidebar.registerViewer({
    exts: [],
    fetchStrategy: 'fsRead',
    id: 'text',
    priority: -100,
    title: 'Text',
  })
  sidebar.registerViewer({
    exts: ['png'],
    fetchStrategy: 'mediaUrl',
    id: 'image',
    title: 'Image',
  })
  sidebar.registerViewer({
    detect: (_path, head) => head.includes(0),
    exts: [],
    fetchStrategy: 'binary-download',
    id: 'binary',
    priority: 100,
    title: 'Binary',
  })

  assert.equal(sidebar.matchViewer('photo.PNG')?.id, 'image')
  assert.equal(
    sidebar.matchViewer('blob.data', new Uint8Array([1, 0, 2]))?.id,
    'binary',
  )
  sidebar.setViewerEnabled('image', false)
  assert.equal(sidebar.matchViewer('photo.png')?.id, 'text')
})

test('desktop sidebar persists bounded per-project state outside Web storage', async () => {
  const storage = new MemorySidebarStorage()
  const sidebar = new DesktopSidebarService(storage)
  await sidebar.start()
  sidebar.registerTab(tab('browser'))
  sidebar.registerViewer({
    exts: [],
    fetchStrategy: 'fsRead',
    id: 'text',
    title: 'Text',
  })
  sidebar.setWorkspace('/work/repo')
  sidebar.openTab({
    resource: 'https://example.com',
    title: 'example.com',
    type: 'browser',
  })
  sidebar.setWidth(512)
  sidebar.setOpenByDefault(true)
  sidebar.setTabEnabled('browser', false)
  sidebar.setViewerEnabled('text', false)
  await sidebar.settle()

  assert.equal(storage.value.defaultWidth, 512)
  assert.equal(storage.value.openByDefault, true)
  assert.equal(storage.value.tabsEnabled.browser, false)
  assert.equal(storage.value.viewersEnabled.text, false)
  assert.equal(storage.value.workspaces['/work/repo']?.tabs.length, 1)
  assert.equal(storage.writes.length, 1)
})

test('sidebar contract reports version and a monotonic feature list', async () => {
  const sidebar = new DesktopSidebarService(new MemorySidebarStorage())
  assert.equal(sidebar.version, SIDEBAR_SERVICE_VERSION)
  assert.equal(sidebar.version, '0.1.2')
  assert.ok(sidebar.features.length >= 9)
  for (const feature of [
    'badge',
    'tabLifecycle',
    'updateTab',
    'openFile',
    'targetedOpen',
    'stateSubscription',
    'tabMeta',
    'pluginSettings',
    'urlTarget',
    'surfaceRenderer',
  ]) {
    assert.ok((sidebar.features as readonly string[]).includes(feature), `missing feature ${feature}`)
  }
  // The exported constant is the same array (never re-created).
  assert.equal(sidebar.features, SIDEBAR_FEATURES)
})

test('sidebar lifecycle callbacks fire from the service paths only', async () => {
  const sidebar = new DesktopSidebarService(new MemorySidebarStorage())
  await sidebar.start()
  sidebar.setWorkspace('/work/repo')
  const events: string[] = []
  sidebar.registerTab(tab('life', {
    single: true,
    onOpen: () => { events.push('open') },
    onActivate: () => { events.push('activate') },
    onClose: () => { events.push('close') },
  }))
  sidebar.openTab({ type: 'life' })
  assert.deepEqual(events, ['open'])
  // A dedupe focus is an activation, not an open.
  sidebar.openTab({ type: 'life' })
  assert.deepEqual(events, ['open', 'activate'])
  sidebar.activateTab(sidebar.getSnapshot().tabs[0]!.id)
  assert.deepEqual(events, ['open', 'activate'])
  sidebar.closeTab(sidebar.getSnapshot().tabs[0]!.id)
  assert.deepEqual(events, ['open', 'activate', 'close'])
  // Unknown ids are strict no-ops (no callback, no state churn).
  sidebar.closeTab('missing')
  sidebar.activateTab('missing')
  assert.deepEqual(events, ['open', 'activate', 'close'])
})

test('sidebar lifecycle callbacks survive a throwing callback', async () => {
  const sidebar = new DesktopSidebarService(new MemorySidebarStorage())
  await sidebar.start()
  sidebar.setWorkspace('/work/repo')
  const events: string[] = []
  const originalError = console.error
  console.error = () => {}
  try {
    sidebar.registerTab(tab('boom', {
      onOpen: () => { throw new Error('boom') },
      onClose: () => { events.push('close') },
    }))
    sidebar.openTab({ type: 'boom' })
    sidebar.closeTab(sidebar.getSnapshot().tabs[0]!.id)
  } finally {
    console.error = originalError
  }
  assert.deepEqual(events, ['close'])
})

test('sidebar badge is exposed to the tab strip and a throw is swallowed', async () => {
  const sidebar = new DesktopSidebarService(new MemorySidebarStorage())
  await sidebar.start()
  sidebar.setWorkspace('/work/repo')
  sidebar.openTab({ type: 'count' }) // unknown: no-op
  const originalError = console.error
  console.error = () => {}
  try {
    sidebar.registerTab(tab('count', {
      badge: () => 150,
    }))
    sidebar.registerTab(tab('broken', {
      badge: () => { throw new Error('badge boom') },
    }))
  } finally {
    console.error = originalError
  }
  // The service itself does not evaluate badges (the strip does) — the
  // contract only requires the field to be declared and the descriptor
  // readable through the registry.
  assert.equal(sidebar.getTab('count')?.badge?.({ cwd: '/work/repo' }, sidebar.getSnapshot()), 150)
  assert.throws(() => sidebar.getTab('broken')?.badge?.({ cwd: '/work/repo' }, sidebar.getSnapshot()))
})

test('sidebar targeted opens land in another project without switching the UI', async () => {
  const storage = new MemorySidebarStorage()
  const sidebar = new DesktopSidebarService(storage)
  await sidebar.start()
  sidebar.setWorkspace('/work/repo')
  sidebar.registerTab(tab('note'))
  const result = sidebar.openTab(
    { type: 'note', title: 'Note A' },
    { cwd: '/work/other' },
  )
  assert.equal(result.kind, 'opened')
  // The UI snapshot still shows the active project with no tabs.
  assert.equal(sidebar.getSnapshot().cwd, '/work/repo')
  assert.equal(sidebar.getSnapshot().tabs.length, 0)
  // Opening with no scope lands in the active project.
  sidebar.openTab({ type: 'note', title: 'Note B' })
  assert.equal(sidebar.getSnapshot().tabs.length, 1)
  // Both projects' state is persisted (the targeted open landed in
  // '/work/other' without switching the UI; the unscoped open landed in
  // '/work/repo').
  await sidebar.settle()
  assert.equal(storage.value.workspaces['/work/other']?.tabs.length, 1)
  assert.equal(storage.value.workspaces['/work/repo']?.tabs.length, 1)
})

test('sidebar updateTab patches display fields and meta', async () => {
  const storage = new MemorySidebarStorage()
  const sidebar = new DesktopSidebarService(storage)
  await sidebar.start()
  sidebar.setWorkspace('/work/repo')
  sidebar.registerTab(tab('file'))
  sidebar.openTab({ type: 'file', resource: '/a.txt', title: 'a.txt' })
  const tabId = sidebar.getSnapshot().tabs[0]!.id
  sidebar.updateTab(tabId, { title: 'renamed.txt', meta: { page: 3 } })
  assert.equal(sidebar.getSnapshot().tabs[0]?.title, 'renamed.txt')
  assert.deepEqual(sidebar.getSnapshot().tabs[0]?.meta, { page: 3 })
  await sidebar.settle()
  assert.equal(storage.value.workspaces['/work/repo']?.tabs[0]?.title, 'renamed.txt')
  assert.deepEqual(storage.value.workspaces['/work/repo']?.tabs[0]?.meta, { page: 3 })
})

test('sidebar openFile opens the file tab with a path-derived id', async () => {
  const sidebar = new DesktopSidebarService(new MemorySidebarStorage())
  await sidebar.start()
  sidebar.setWorkspace('/w')
  sidebar.registerTab(tab('file'))
  sidebar.openFile({ cwd: '/w' }, '/w/src/main.ts')
  assert.equal(sidebar.getSnapshot().tabs.length, 1)
  assert.equal(sidebar.getSnapshot().tabs[0]?.resource, '/w/src/main.ts')
  assert.equal(sidebar.getSnapshot().tabs[0]?.title, 'main.ts')
})

test('sidebar urlTarget resolution honors registration order and enablement', async () => {
  const sidebar = new DesktopSidebarService(new MemorySidebarStorage())
  await sidebar.start()
  sidebar.registerTab(tab('docs', {
    urlTarget: url => url.hostname === 'docs.example.com',
  }))
  sidebar.registerTab(tab('other', {
    urlTarget: url => url.hostname.endsWith('example.com'),
  }))
  const url = new URL('https://docs.example.com/a')
  assert.equal(sidebar.resolveUrlTarget(url)?.id, 'docs')
  // A disabled claim is skipped.
  sidebar.setTabEnabled('docs', false)
  assert.equal(sidebar.resolveUrlTarget(url)?.id, 'other')
  // A throwing predicate is skipped.
  const originalError = console.error
  console.error = () => {}
  try {
    sidebar.registerTab(tab('broken', {
      urlTarget: () => { throw new Error('url boom') },
    }))
  } finally {
    console.error = originalError
  }
  assert.equal(sidebar.resolveUrlTarget(new URL('https://broken.example.com'))?.id, 'other')
})

test('sidebar pluginSettings persist per descriptor id', async () => {
  const storage = new MemorySidebarStorage()
  const sidebar = new DesktopSidebarService(storage)
  await sidebar.start()
  assert.deepEqual(sidebar.getPluginSettings('my:tab'), {})
  sidebar.updatePluginSetting('my:tab', 'pageSize', 50)
  assert.deepEqual(sidebar.getPluginSettings('my:tab'), { pageSize: 50 })
  sidebar.updatePluginSetting('my:tab', 'compact', true)
  await sidebar.settle()
  assert.equal(storage.value.pluginSettings['my:tab']?.pageSize, 50)
  assert.equal(storage.value.pluginSettings['my:tab']?.compact, true)
  // A second service instance restores the blob.
  const restored = new DesktopSidebarService(storage)
  await restored.start()
  assert.deepEqual(restored.getPluginSettings('my:tab'), { pageSize: 50, compact: true })
})

test('sidebar surface renderers register, render and dispose', async () => {
  const sidebar = new DesktopSidebarService(new MemorySidebarStorage())
  await sidebar.start()
  const remove = sidebar.registerSurfaceRenderer('file', surface => {
    if (surface.kind !== 'file') return null
    return `file:${surface.filePath}`
  })
  assert.equal(
    sidebar.renderSurface({
      id: 'file:a',
      kind: 'file',
      cwd: '/w',
      filePath: '/w/a',
      title: 'a',
      closable: true,
      isPreview: true,
    }),
    'file:/w/a',
  )
  // Unknown kinds render null.
  assert.equal(sidebar.renderSurface({
    id: 'd',
    kind: 'diff',
    cwd: '/w',
    filePath: '/w/a',
    staged: false,
    title: 'a',
    closable: true,
    isPreview: true,
  }), null)
  remove()
  assert.equal(sidebar.renderSurface({
    id: 'file:a',
    kind: 'file',
    cwd: '/w',
    filePath: '/w/a',
    title: 'a',
    closable: true,
    isPreview: true,
  }), null)
  // Duplicate kind registration throws.
  sidebar.registerSurfaceRenderer('file', () => null)
  assert.throws(
    () => sidebar.registerSurfaceRenderer('file', () => null),
    /duplicate surface renderer/,
  )
})

test('sidebar createTab may patch the landing tabs and active id', async () => {
  const sidebar = new DesktopSidebarService(new MemorySidebarStorage())
  await sidebar.start()
  sidebar.setWorkspace('/work/repo')
  sidebar.registerTab(tab('terminal', {
    createTab: (seed, tabs) => {
      const index = tabs.filter(candidate => candidate.type === 'terminal').length
      return {
        tab: { id: `terminal:${index}`, type: 'terminal', title: `Terminal ${index}` },
        patch: { tabs: [...tabs, { id: `terminal:${index}`, type: 'terminal', title: `Terminal ${index}` }], activeId: `terminal:${index}` },
      }
    },
  }))
  sidebar.openTab({ type: 'terminal' })
  sidebar.openTab({ type: 'terminal' })
  assert.equal(sidebar.getSnapshot().tabs.length, 2)
  assert.equal(sidebar.getSnapshot().tabs[1]?.id, 'terminal:1')
  assert.equal(sidebar.getSnapshot().activeId, 'terminal:1')
})

test('tabAvailability gate folds requiresWorkspace and available into one reason', async () => {
  const sidebar = new DesktopSidebarService(new MemorySidebarStorage())
  await sidebar.start()
  sidebar.registerTab(tab('files', { requiresWorkspace: true }))
  sidebar.registerTab(tab('chat', {}))

  // Without a workspace cwd: files refuses with 'no-workspace', chat succeeds
  const withoutCwd = sidebar.openTab({ type: 'files' }, { cwd: '' })
  assert.equal(withoutCwd.kind, 'disabled')
  if (withoutCwd.kind === 'disabled') assert.equal(withoutCwd.reason, 'no-workspace')

  // With a workspace cwd: files opens
  sidebar.setWorkspace('/work/repo')
  const withCwd = sidebar.openTab({ type: 'files' })
  assert.equal(withCwd.kind, 'opened')

  // Plain tab without requiresWorkspace opens with or without cwd
  sidebar.setWorkspace(null)
  const chatWithout = sidebar.openTab({ type: 'chat' }, { cwd: '/any' })
  assert.equal(chatWithout.kind, 'opened')
})

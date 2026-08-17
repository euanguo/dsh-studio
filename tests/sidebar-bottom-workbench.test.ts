import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DesktopSidebarService,
  type SidebarTabDescriptor,
} from '../plugins/sidebar/src/client/sidebar-service.ts'
import type { SidebarPreferencesStorage } from '../plugins/sidebar/src/client/sidebar-storage.ts'
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  parseSidebarPreferences,
  type DesktopSidebarPreferences,
} from '../plugins/sidebar/src/sidebar-preferences.ts'

class MemorySidebarStorage implements SidebarPreferencesStorage {
  value: DesktopSidebarPreferences

  constructor(value?: DesktopSidebarPreferences) {
    this.value = value ?? {
      ...DEFAULT_SIDEBAR_PREFERENCES,
      sessions: {},
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
  }
}

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

async function readySidebar(
  options: { opened?: string[]; storage?: MemorySidebarStorage } = {},
): Promise<{ sidebar: DesktopSidebarService; storage: MemorySidebarStorage }> {
  const storage = options.storage ?? new MemorySidebarStorage()
  const sidebar = new DesktopSidebarService(storage)
  sidebar.registerTab(tab('file'))
  sidebar.registerTab(tab('browser'))
  sidebar.registerTab(tab('side-chat'))
  sidebar.setSession('session-1', '/work')
  await sidebar.start()
  for (const id of options.opened ?? []) {
    sidebar.openTab({ type: id, id, title: id })
  }
  return { sidebar, storage }
}

test('legacy sessions without a bottom workbench parse to an empty one', () => {
  const legacy = {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    sessions: {
      old: {
        activeId: null,
        lastUsed: 1,
        tabs: [],
      },
    },
    tabsEnabled: {},
    viewersEnabled: {},
    pluginSettings: {},
  }
  const parsed = parseSidebarPreferences(legacy)
  assert.ok(parsed !== undefined)
  assert.deepEqual(parsed.sessions.old?.bottomTabs, [])
  assert.equal(parsed.sessions.old?.bottomActiveId, null)
})

test('moveTab reorders the right rail and persists the order', async () => {
  const { sidebar, storage } = await readySidebar({
    opened: ['file', 'browser', 'side-chat'],
  })
  sidebar.moveTab('browser', 0)
  assert.deepEqual(
    sidebar.getSnapshot().tabs.map(tab => tab.id),
    ['browser', 'file', 'side-chat'],
  )
  await sidebar.settle()
  const restored = storage.value.sessions['session-1']
  assert.deepEqual(restored?.tabs.map(tab => tab.id), ['browser', 'file', 'side-chat'])
})

test('moveTabToBottom docks a rail tab, activates it, and repairs the rail active', async () => {
  const { sidebar } = await readySidebar({ opened: ['file', 'browser', 'side-chat'] })
  sidebar.activateTab('browser')
  sidebar.moveTabToBottom('browser', 0)
  const snapshot = sidebar.getSnapshot()
  assert.deepEqual(snapshot.tabs.map(tab => tab.id), ['file', 'side-chat'])
  assert.deepEqual(snapshot.bottomTabs.map(tab => tab.id), ['browser'])
  assert.equal(snapshot.bottomActiveId, 'browser')
  // The rail activates the moved tab's NEIGHBOR (browser was active at
  // index 1 → the tab now at that index, side-chat).
  assert.equal(snapshot.activeId, 'side-chat')
})

test('moveBottomTabToSide undocks a tab back into the rail and activates it', async () => {
  const { sidebar } = await readySidebar({ opened: ['file', 'browser'] })
  sidebar.moveTabToBottom('browser')
  sidebar.moveBottomTabToSide('browser', 0)
  const snapshot = sidebar.getSnapshot()
  assert.deepEqual(snapshot.tabs.map(tab => tab.id), ['browser', 'file'])
  assert.deepEqual(snapshot.bottomTabs, [])
  assert.equal(snapshot.activeId, 'browser')
  assert.equal(snapshot.bottomActiveId, null)
})

test('moveBottomTab reorders inside the bottom workbench', async () => {
  const { sidebar } = await readySidebar({ opened: ['file', 'browser', 'side-chat'] })
  sidebar.moveTabToBottom('browser')
  sidebar.moveTabToBottom('side-chat')
  sidebar.moveBottomTab('side-chat', 0)
  assert.deepEqual(
    sidebar.getSnapshot().bottomTabs.map(tab => tab.id),
    ['side-chat', 'browser'],
  )
})

test('activateBottomTab switches the docked pane; closeBottomTab fires onClose', async () => {
  const closed: string[] = []
  const storage = new MemorySidebarStorage()
  const sidebar = new DesktopSidebarService(storage)
  sidebar.registerTab(tab('file'))
  sidebar.registerTab(tab('browser', {
    onClose: (closedTab) => { closed.push(closedTab.id) },
  }))
  sidebar.setSession('session-1', '/work')
  await sidebar.start()
  sidebar.openTab({ type: 'browser', id: 'browser', title: 'browser' })
  sidebar.openTab({ type: 'file', id: 'file', title: 'file' })
  sidebar.moveTabToBottom('browser')
  sidebar.moveTabToBottom('file')
  sidebar.activateBottomTab('file')
  assert.equal(sidebar.getSnapshot().bottomActiveId, 'file')
  sidebar.closeBottomTab('browser')
  assert.deepEqual(closed, ['browser'])
  assert.deepEqual(sidebar.getSnapshot().bottomTabs.map(tab => tab.id), ['file'])
  assert.equal(sidebar.getSnapshot().bottomActiveId, 'file')
})

test('openTab dedupes into the bottom workbench and focuses the docked tab', async () => {
  const { sidebar } = await readySidebar({ opened: ['browser'] })
  sidebar.moveTabToBottom('browser')
  const result = sidebar.openTab({ type: 'browser', id: 'browser', title: 'browser' })
  assert.equal(result.kind, 'focused')
  assert.equal(sidebar.getSnapshot().bottomActiveId, 'browser')
  assert.equal(sidebar.getSnapshot().tabs.length, 0)
})

test('the bottom workbench survives a reload through the persisted preferences', async () => {
  const storage = new MemorySidebarStorage()
  const first = await readySidebar({ storage, opened: ['browser'] })
  first.sidebar.moveTabToBottom('browser')
  await first.sidebar.settle()

  const second = new DesktopSidebarService(storage)
  second.registerTab(tab('browser'))
  second.setSession('session-1', '/work')
  await second.start()
  const snapshot = second.getSnapshot()
  assert.deepEqual(snapshot.bottomTabs.map(tab => tab.id), ['browser'])
  assert.equal(snapshot.bottomActiveId, 'browser')
})
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createDockStore,
  hasPersistedDockState,
  nextTabId,
  panelReducer,
  terminalFontPrefActions,
  type TerminalPanelState,
} from '../plugins/panel-controls/src/terminal/panel-store.ts'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

test('terminal tabs survive activation and close their own state only', () => {
  const initial: TerminalPanelState = {
    collapsed: false,
    size: 280,
    fontFamily: 'monospace',
    fontSize: 13,
    tabs: [],
    activeTabId: null,
  }
  const first = nextTabId()
  const second = nextTabId()
  const withTabs = panelReducer(panelReducer(initial, { type: 'add-tab', id: first }), { type: 'add-tab', id: second })
  const activated = panelReducer(withTabs, { type: 'activate-tab', id: first })
  const closed = panelReducer(activated, { type: 'remove-tab', id: first })
  assert.deepEqual(closed.tabs.map(tab => tab.id), [second])
  assert.equal(closed.activeTabId, second)
})

test('terminal dock preferences are scoped per DSH session', () => {
  const storage = new MemoryStorage()
  const first = createDockStore(storage, 'session-a')
  const second = createDockStore(storage, 'session-b')
  first.dispatch({ type: 'set-size', size: 420 })
  first.dispatch({ type: 'set-collapsed', collapsed: false })
  assert.equal(createDockStore(storage, 'session-a').getState().size, 420)
  assert.equal(createDockStore(storage, 'session-a').getState().collapsed, false)
  assert.equal(second.getState().size, 280)
  assert.equal(second.getState().collapsed, true)
})

test('terminal font pref actions: empty family = no override, size clamped', () => {
  // The default prefs ('' / 13) are a no-op — persisted dock fonts survive.
  assert.deepEqual(terminalFontPrefActions('', 13), [])
  // An empty family with a different size still applies the size.
  assert.deepEqual(terminalFontPrefActions('', 16), [
    { type: 'set-font-size', fontSize: 16 },
  ])
  assert.deepEqual(terminalFontPrefActions('  ', 16), [
    { type: 'set-font-size', fontSize: 16 },
  ])
  // A family alone applies without touching the size.
  assert.deepEqual(terminalFontPrefActions('JetBrains Mono', 13), [
    { type: 'set-font-family', fontFamily: 'JetBrains Mono' },
  ])
  // Out-of-range / non-finite sizes are clamped to the 9–32 contract.
  assert.deepEqual(terminalFontPrefActions('Fira Code', 8), [
    { type: 'set-font-family', fontFamily: 'Fira Code' },
    { type: 'set-font-size', fontSize: 9 },
  ])
  assert.deepEqual(terminalFontPrefActions('Fira Code', 40), [
    { type: 'set-font-family', fontFamily: 'Fira Code' },
    { type: 'set-font-size', fontSize: 32 },
  ])
  assert.deepEqual(terminalFontPrefActions('Fira Code', Number.NaN), [
    { type: 'set-font-family', fontFamily: 'Fira Code' },
  ])
})

test('terminal dock persistence detection mirrors the read chain', () => {
  const storage = new MemoryStorage()
  assert.equal(hasPersistedDockState(storage, 'session-a'), false)
  const store = createDockStore(storage, 'session-a')
  store.dispatch({ type: 'set-size', size: 320 })
  assert.equal(hasPersistedDockState(storage, 'session-a'), true)
  assert.equal(hasPersistedDockState(storage, 'session-b'), false)
})

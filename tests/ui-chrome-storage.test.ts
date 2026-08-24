import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  UI_CHROME_TABLES,
  defaultLeftRailViewChrome,
  sanitizeLeftRailViewChrome,
  type LeftRailViewChrome,
} from '@dsh-studio/shared/ui-chrome-tables'
import { createUiChromeStorage, type UiChromeStorageApi } from '@dsh-studio/shared/ui-chrome-storage'

function view(groupBy: LeftRailViewChrome['groupBy']): LeftRailViewChrome {
  return {
    groupBy,
    orderBy: 'updated',
    groupExpansion: { 'workspace:/repo': true },
    sessionOrder: { project: ['session-a'] },
  }
}

test('UI chrome storage sanitizes reads and serializes the latest debounced write', async () => {
  const writes: unknown[] = []
  const api: UiChromeStorageApi = {
    get: async () => ({
      groupBy: 'manual',
      orderBy: 'manual',
      groupExpansion: { project: true },
      sessionOrder: { project: ['session-a'] },
    }),
    put: async (_table, value) => { writes.push(value) },
    delete: async () => {},
  }
  const storage = createUiChromeStorage({
    table: UI_CHROME_TABLES.leftRailView,
    defaults: defaultLeftRailViewChrome,
    sanitize: sanitizeLeftRailViewChrome,
    debounceMs: 60_000,
    api,
  })

  assert.deepEqual(await storage.load(), {
    groupBy: 'workspace',
    orderBy: 'manual',
    groupExpansion: { project: true },
    sessionOrder: { project: ['session-a'] },
  })
  storage.save(view('workspace'))
  storage.save(view('flat'))
  await storage.flush()

  assert.deepEqual(writes, [view('flat')])
  assert.equal(storage.availability(), 'available')
})

test('UI chrome storage starts clean when unavailable and retries the host path later', async () => {
  let available = false
  const writes: unknown[] = []
  const api: UiChromeStorageApi = {
    get: async () => {
      throw new Error('storage unavailable')
    },
    put: async (_table, value) => {
      if (!available) throw new Error('storage unavailable')
      writes.push(value)
    },
    delete: async () => {},
  }
  const storage = createUiChromeStorage({
    table: UI_CHROME_TABLES.leftRailView,
    defaults: defaultLeftRailViewChrome,
    sanitize: sanitizeLeftRailViewChrome,
    debounceMs: 60_000,
    api,
  })

  assert.deepEqual(await storage.load(), defaultLeftRailViewChrome())
  assert.equal(storage.availability(), 'unavailable')
  storage.save(view('flat'))
  await storage.flush()
  assert.deepEqual(writes, [])

  available = true
  await storage.flush()
  assert.deepEqual(writes, [view('flat')])
  assert.equal(storage.availability(), 'available')
})

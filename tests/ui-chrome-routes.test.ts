import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildUiChromeHandlers } from '../plugins/capabilities/src/routes/ui-chrome.ts'
import { UI_CHROME_TABLES, type UiChromeTableName } from '@dsh-studio/shared/ui-chrome-tables'
import { CapabilityError } from '@dsh-studio/shared/wire'
import type { UiChromeFace } from '../plugins/capabilities/src/routes/ui-chrome.ts'

function face(): UiChromeFace {
  const values = new Map<UiChromeTableName, unknown>()
  return {
    get: table => values.get(table),
    async put(table, value) {
      values.set(table, value)
      return value
    },
    async delete(table) {
      return values.delete(table)
    },
  }
}

test('UI chrome routes use fixed tables and round-trip one full record', async () => {
  const chrome = face()
  const routes = buildUiChromeHandlers({ getUiChrome: async () => chrome })
  const put = routes['ui-chrome.put']!
  const get = routes['ui-chrome.get']!
  const value = { groupBy: 'flat' }

  assert.deepEqual(await put({ table: UI_CHROME_TABLES.leftRailView, value }), { value })
  assert.deepEqual(await get({ table: UI_CHROME_TABLES.leftRailView }), { value })
})

test('UI chrome routes reject unknown tables and expose an unavailable host as 503', async () => {
  const routes = buildUiChromeHandlers({ getUiChrome: async () => undefined })
  await assert.rejects(
    Promise.resolve(routes['ui-chrome.get']!({ table: 'left-rail-view' })),
    (error: unknown) => error instanceof CapabilityError && error.code === 'bad-request',
  )
  await assert.rejects(
    Promise.resolve(routes['ui-chrome.get']!({ table: UI_CHROME_TABLES.leftRailView })),
    (error: unknown) => error instanceof CapabilityError && error.status === 503,
  )
})

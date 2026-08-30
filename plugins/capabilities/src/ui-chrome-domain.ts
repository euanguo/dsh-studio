/**
 * Final domain declaration for durable UI chrome. Every table holds one
 * complete DTO record under the fixed `state` key; route callers never choose
 * a storage key.
 *
 * The zod schemas themselves are derived once in `ui-chrome-schemas.ts`
 * (pure, testable without a runtime medium); this module only declares the
 * storage domain over them and adapts the face used by the routes.
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { CapabilityError } from '@dsh-studio/shared/wire'
import type { UiChromeFace } from './routes/ui-chrome.ts'
import { UI_CHROME_DOMAIN_NAME, UI_CHROME_RECORD_KEY, UI_CHROME_TABLES, type UiChromeTableName } from '@dsh-studio/shared/ui-chrome-tables'
import { parseUiChromeValue, uiChromeTableZodSchemas } from './ui-chrome-schemas.ts'

export const UI_CHROME_DOMAIN = defineDomain({
  name: UI_CHROME_DOMAIN_NAME,
  version: 1,
  tables: {
    [UI_CHROME_TABLES.leftRailView]: domainTable(uiChromeTableZodSchemas[UI_CHROME_TABLES.leftRailView]),
    [UI_CHROME_TABLES.centerSurfaces]: domainTable(uiChromeTableZodSchemas[UI_CHROME_TABLES.centerSurfaces]),
    [UI_CHROME_TABLES.sidebarChrome]: domainTable(uiChromeTableZodSchemas[UI_CHROME_TABLES.sidebarChrome]),
    [UI_CHROME_TABLES.sidebarLayouts]: domainTable(uiChromeTableZodSchemas[UI_CHROME_TABLES.sidebarLayouts]),
    [UI_CHROME_TABLES.flags]: domainTable(uiChromeTableZodSchemas[UI_CHROME_TABLES.flags]),
    [UI_CHROME_TABLES.comments]: domainTable(uiChromeTableZodSchemas[UI_CHROME_TABLES.comments]),
  },
})

export interface UiChromeDomain {
  table(name: UiChromeTableName): {
    get(key: string): unknown
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<boolean>
  }
  close(): Promise<void>
}

export { parseUiChromeValue }

export function createUiChromeFace(domain: UiChromeDomain): UiChromeFace {
  return {
    get: table => domain.table(table).get(UI_CHROME_RECORD_KEY),
    async put(table, value) {
      let parsed: unknown
      try {
        parsed = parseUiChromeValue(table, value)
      } catch {
        throw new CapabilityError('bad-request', 'invalid UI chrome value')
      }
      await domain.table(table).put(UI_CHROME_RECORD_KEY, parsed)
      return parsed
    },
    delete: table => domain.table(table).delete(UI_CHROME_RECORD_KEY),
  }
}

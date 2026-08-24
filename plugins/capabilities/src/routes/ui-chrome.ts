/** Durable UI chrome capability routes. All tables are fixed by the host. */
import {
  isUiChromeTableName,
  type UiChromeTableName,
} from '@dsh-studio/shared/ui-chrome-tables'
import { CapabilityError, requireString } from '@dsh-studio/shared/wire'
import type { ApiMethod } from './types.ts'

export interface UiChromeFace {
  get(table: UiChromeTableName): unknown
  put(table: UiChromeTableName, value: unknown): Promise<unknown>
  delete(table: UiChromeTableName): Promise<boolean>
}

export interface UiChromeRoutesOptions {
  getUiChrome(): Promise<UiChromeFace | undefined>
}

function tableOf(payload: unknown): UiChromeTableName {
  const table = requireString(payload, 'table')
  if (!isUiChromeTableName(table)) {
    throw new CapabilityError('bad-request', 'unknown UI chrome table')
  }
  return table
}

async function requireUiChrome(getUiChrome: UiChromeRoutesOptions['getUiChrome']): Promise<UiChromeFace> {
  const face = await getUiChrome()
  if (face === undefined) {
    throw new CapabilityError('internal', 'UI chrome storage is unavailable', 503)
  }
  return face
}

export function buildUiChromeHandlers(options: UiChromeRoutesOptions): Record<string, ApiMethod> {
  return {
    'ui-chrome.get': async (payload) => {
      const table = tableOf(payload)
      return { value: (await requireUiChrome(options.getUiChrome)).get(table) }
    },
    'ui-chrome.put': async (payload) => {
      const table = tableOf(payload)
      const record = payload as { value?: unknown }
      return { value: await (await requireUiChrome(options.getUiChrome)).put(table, record.value) }
    },
    'ui-chrome.delete': async (payload) => {
      const table = tableOf(payload)
      return { deleted: await (await requireUiChrome(options.getUiChrome)).delete(table) }
    },
  }
}

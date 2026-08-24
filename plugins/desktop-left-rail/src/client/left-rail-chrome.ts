/** Durable UI chrome for the workspace browser's reproducible view state. */
import {
  UI_CHROME_TABLES,
  defaultLeftRailViewChrome,
  sanitizeLeftRailViewChrome,
  type LeftRailViewChrome,
} from '@dsh-studio/shared/ui-chrome-tables'
import { createUiChromeStorage } from '@dsh-studio/shared/ui-chrome-storage'

const storage = createUiChromeStorage<LeftRailViewChrome>({
  table: UI_CHROME_TABLES.leftRailView,
  defaults: defaultLeftRailViewChrome,
  sanitize: sanitizeLeftRailViewChrome,
  debounceMs: 300,
})

export type { LeftRailViewChrome } from '@dsh-studio/shared/ui-chrome-tables'

export function loadLeftRailChrome(signal?: AbortSignal): Promise<LeftRailViewChrome> {
  return storage.load(signal)
}

export function saveLeftRailChrome(value: LeftRailViewChrome): void {
  storage.save(value)
}

export function flushLeftRailChrome(): Promise<void> {
  return storage.flush()
}

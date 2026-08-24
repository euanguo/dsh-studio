/** Domain-backed persistence seam for right-sidebar layout chrome. */
import {
  UI_CHROME_TABLES,
} from '@dsh-studio/shared/ui-chrome-tables'
import { createUiChromeStorage } from '@dsh-studio/shared/ui-chrome-storage'
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  parseSidebarPreferences,
  type DesktopSidebarPreferences,
} from '../sidebar-preferences.ts'

export interface SidebarPreferencesStorage {
  load(): Promise<DesktopSidebarPreferences>
  save(preferences: DesktopSidebarPreferences): Promise<void>
}

function defaults(): DesktopSidebarPreferences {
  return {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    workspaces: {},
    pluginSettings: {},
  }
}

const storage = createUiChromeStorage<DesktopSidebarPreferences>({
  table: UI_CHROME_TABLES.sidebarLayouts,
  defaults,
  sanitize: value => parseSidebarPreferences(value) ?? defaults(),
  debounceMs: 250,
})

/**
 * The right sidebar owns layout state only. Feature enablement belongs to the
 * settings namespace and is supplied to DesktopSidebarService separately.
 */
export class DomainSidebarPreferencesStorage implements SidebarPreferencesStorage {
  load(): Promise<DesktopSidebarPreferences> {
    return storage.load()
  }

  async save(preferences: DesktopSidebarPreferences): Promise<void> {
    storage.save(preferences)
    await storage.flush()
  }
}

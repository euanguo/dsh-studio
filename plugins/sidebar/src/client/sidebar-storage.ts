import {
  DEFAULT_SIDEBAR_PREFERENCES,
  parseSidebarPreferences,
  type DesktopSidebarPreferences,
} from '../sidebar-preferences.ts'

export interface SidebarPreferencesStorage {
  load(): Promise<DesktopSidebarPreferences>
  save(preferences: DesktopSidebarPreferences): Promise<void>
}

const STORAGE_KEY = 'oh-dsh-desktop.sidebar-preferences'

/**
 * Client-side persistence for the sidebar's UI preferences (width, default
 * open, per-tab/viewer enable switches, per-session tab layouts). Stored in
 * localStorage so the sidebar needs no host file system / appDataPath — this
 * is what lets the sidebar run as a generic DSH plugin outside the desktop.
 */
export class LocalStorageSidebarPreferencesStorage
implements SidebarPreferencesStorage {
  async load(): Promise<DesktopSidebarPreferences> {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      return {
        ...DEFAULT_SIDEBAR_PREFERENCES,
        sessions: {},
        tabsEnabled: {},
        viewersEnabled: {},
      }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      throw new Error('sidebar preferences are invalid JSON')
    }
    const preferences = parseSidebarPreferences(parsed)
    if (preferences === undefined) {
      throw new Error('sidebar preferences are invalid')
    }
    return preferences
  }

  async save(preferences: DesktopSidebarPreferences): Promise<void> {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  }
}

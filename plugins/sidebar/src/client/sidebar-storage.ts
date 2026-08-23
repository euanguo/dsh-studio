import {
  DEFAULT_SIDEBAR_PREFERENCES,
  parseSidebarPreferences,
  type DesktopSidebarPreferences,
} from '../sidebar-preferences.ts'

export interface SidebarPreferencesStorage {
  load(): Promise<DesktopSidebarPreferences>
  save(preferences: DesktopSidebarPreferences): Promise<void>
}

const STORAGE_KEY = 'dsh-studio.sidebar-preferences.v2'

/**
 * Client-side persistence for the sidebar's UI preferences (width, default
 * open, per-tab/viewer enable switches, per-session tab layouts). Stored in
 * localStorage so the sidebar needs no host file system / appDataPath — this
 * is what lets the sidebar run as a generic DSH plugin outside the desktop.
 *
 * STORE BOUNDARY (deliberate, do not merge with runtime-settings): the
 * sidebar intentionally persists to TWO stores with different ownership —
 *   - HERE (localStorage): per-BROWSER UI session state. Tab layouts are
 *     window-local; two browsers on the same profile keep independent
 *     layouts, and a corrupted layout never touches the host.
 *   - runtime-settings (host settings namespace via /capabilities/api
 *     settings.*): FEATURE preferences (interception switches, terminal
 *     font/shell, agent tools) that must follow the user across browsers
 *     and surfaces.
 * Folding either into the other is a regression: layouts on the host lose
 * browser isolation; feature prefs in localStorage stop syncing.
 */
export class LocalStorageSidebarPreferencesStorage
implements SidebarPreferencesStorage {
  async load(): Promise<DesktopSidebarPreferences> {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) {
      return {
        ...DEFAULT_SIDEBAR_PREFERENCES,
        workspaces: {},
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

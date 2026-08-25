/** Domain-backed persistence seam for right-sidebar layout chrome. */
import {
  UI_CHROME_TABLES,
} from '@dsh-studio/shared/ui-chrome-tables'
import { createUiChromeStorage } from '@dsh-studio/shared/ui-chrome-storage'
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  SIDEBAR_LAYOUTS_VERSION,
  parseSidebarPreferences,
  type DesktopSidebarPreferences,
} from '../sidebar-preferences.ts'

export interface SidebarPreferencesStorage {
  load(): Promise<DesktopSidebarPreferences>
  save(preferences: DesktopSidebarPreferences): Promise<void>
}

/**
 * The persisted layout document: the sidebar preferences plus a `version`
 * header (M2) so a later migration can branch on the stored layout semantics.
 * The in-memory `DesktopSidebarPreferences` is kept version-free; the version
 * lives only at the storage boundary.
 */
type SidebarLayoutsDocument = DesktopSidebarPreferences & { version: number }

function defaults(): DesktopSidebarPreferences {
  return {
    ...DEFAULT_SIDEBAR_PREFERENCES,
    workspaces: {},
    pluginSettings: {},
  }
}

function defaultDocument(): SidebarLayoutsDocument {
  return { ...defaults(), version: SIDEBAR_LAYOUTS_VERSION }
}

const storage = createUiChromeStorage<SidebarLayoutsDocument>({
  table: UI_CHROME_TABLES.sidebarLayouts,
  defaults: defaultDocument,
  sanitize: value => {
    const parsed = parseSidebarPreferences(value)
    if (parsed === undefined) return defaultDocument()
    // Re-stamp the current version on every read so legacy (v1) documents are
    // normalized to the writer's version and the header is always carried.
    // `parseSidebarPreferences` is per-entry tolerant (F9): a bad workspace,
    // oversized tab list, or corrupt plugin blob is dropped/truncated, never
    // allowed to wipe the whole layout.
    return { ...parsed, version: SIDEBAR_LAYOUTS_VERSION }
  },
  debounceMs: 250,
})

/**
 * The right sidebar owns layout state only. Feature enablement belongs to the
 * settings namespace and is supplied to DesktopSidebarService separately.
 */
export class DomainSidebarPreferencesStorage implements SidebarPreferencesStorage {
  async load(): Promise<DesktopSidebarPreferences> {
    const doc = await storage.load()
    // Strip the storage-only `version` header before returning the in-memory
    // preferences object.
    return {
      defaultWidth: doc.defaultWidth,
      openByDefault: doc.openByDefault,
      workspaces: doc.workspaces,
      pluginSettings: doc.pluginSettings,
      centerPreviewTabs: doc.centerPreviewTabs,
      layoutScope: doc.layoutScope,
    }
  }

  async save(preferences: DesktopSidebarPreferences): Promise<void> {
    storage.save({ ...preferences, version: SIDEBAR_LAYOUTS_VERSION })
    await storage.flush()
  }
}
/**
 * Browser-safe DTOs and names for durable UI chrome. The host owns validation
 * and persistence; clients use these values only through ui-chrome routes.
 */

/** Runtime storage descriptor name. The JSON backend accepts snake_case only. */
export const UI_CHROME_DOMAIN_NAME = 'dsh_studio_ui'
/** One full-state record is stored in every table. */
export const UI_CHROME_RECORD_KEY = 'state'

export const UI_CHROME_TABLES = {
  leftRailView: 'left_rail_view',
  centerSurfaces: 'center_surfaces',
  sidebarChrome: 'sidebar_chrome',
  sidebarLayouts: 'sidebar_layouts',
  flags: 'flags',
} as const

export type UiChromeTableName = typeof UI_CHROME_TABLES[keyof typeof UI_CHROME_TABLES]

export const UI_CHROME_TABLE_NAMES = Object.freeze(Object.values(UI_CHROME_TABLES))

export function isUiChromeTableName(value: unknown): value is UiChromeTableName {
  return typeof value === 'string'
    && (UI_CHROME_TABLE_NAMES as readonly string[]).includes(value)
}

export interface ExplorerChromeSlice {
  expandedPaths: string[]
  selectedPath: string | null
}

export interface SourceControlChromeSlice {
  collapsedSections: string[]
  collapsedDirectories: string[]
  selectedPath: string | null
  commitMessage: string
}

export type GitListMode = 'tree' | 'flat'

export interface SidebarChromeSlice {
  explorer: ExplorerChromeSlice
  sourceControl: SourceControlChromeSlice
  gitListMode: GitListMode
}

export interface SidebarChromeState {
  byScope: Record<string, SidebarChromeSlice>
}

export function defaultSidebarChromeSlice(): SidebarChromeSlice {
  return {
    explorer: { expandedPaths: [], selectedPath: null },
    sourceControl: {
      collapsedSections: [],
      collapsedDirectories: [],
      selectedPath: null,
      commitMessage: '',
    },
    gitListMode: 'tree',
  }
}

export function defaultSidebarChromeState(): SidebarChromeState {
  return { byScope: {} }
}

export function sanitizeSidebarChrome(value: unknown): SidebarChromeState {
  const record = isRecord(value) ? value : {}
  const raw = isRecord(record.byScope) ? record.byScope : {}
  const byScope: Record<string, SidebarChromeSlice> = {}
  for (const [scope, entry] of Object.entries(raw).slice(0, 500)) {
    if (!validKey(scope) || !isRecord(entry)) continue
    const explorer = isRecord(entry.explorer) ? entry.explorer : {}
    const sourceControl = isRecord(entry.sourceControl) ? entry.sourceControl : {}
    const strings = (candidate: unknown): string[] => Array.isArray(candidate)
      ? candidate.filter(item => typeof item === 'string' && validKey(item)).slice(0, 2_000)
      : []
    byScope[scope] = {
      explorer: {
        expandedPaths: strings(explorer.expandedPaths),
        selectedPath: typeof explorer.selectedPath === 'string' ? explorer.selectedPath : null,
      },
      sourceControl: {
        collapsedSections: strings(sourceControl.collapsedSections),
        collapsedDirectories: strings(sourceControl.collapsedDirectories),
        selectedPath: typeof sourceControl.selectedPath === 'string' ? sourceControl.selectedPath : null,
        commitMessage: typeof sourceControl.commitMessage === 'string' ? sourceControl.commitMessage : '',
      },
      gitListMode: entry.gitListMode === 'flat' ? 'flat' : 'tree',
    }
  }
  return { byScope }
}

export interface UiChromeFlags {
  pinnedSummaryOpen: boolean
  pluginMarketplaceOpen: boolean
}

export function defaultUiChromeFlags(): UiChromeFlags {
  return { pinnedSummaryOpen: false, pluginMarketplaceOpen: false }
}

export function sanitizeUiChromeFlags(value: unknown): UiChromeFlags {
  const record = isRecord(value) ? value : {}
  return {
    pinnedSummaryOpen: record.pinnedSummaryOpen === true,
    pluginMarketplaceOpen: record.pluginMarketplaceOpen === true,
  }
}

export interface LeftRailViewChrome {
  groupBy: 'workspace' | 'flat'
  orderBy: 'manual' | 'updated'
  groupExpansion: Record<string, boolean>
  sessionOrder: Record<string, string[]>
}

export function defaultLeftRailViewChrome(): LeftRailViewChrome {
  return {
    groupBy: 'workspace',
    orderBy: 'updated',
    groupExpansion: {},
    sessionOrder: {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validKey(value: string): boolean {
  return value.length > 0 && value.length <= 4096 && !value.includes('\0')
}

function booleanMap(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {}
  const result: Record<string, boolean> = {}
  for (const [key, entry] of Object.entries(value).slice(0, 2_000)) {
    if (validKey(key) && typeof entry === 'boolean') result[key] = entry
  }
  return result
}

function stringArrayMap(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {}
  const result: Record<string, string[]> = {}
  for (const [key, entry] of Object.entries(value).slice(0, 2_000)) {
    if (!validKey(key) || !Array.isArray(entry)) continue
    const values = entry.slice(0, 2_000)
    if (values.every(item => typeof item === 'string' && validKey(item))) {
      result[key] = [...values]
    }
  }
  return result
}

/** Drop malformed persisted fields and restore missing fields to final defaults. */
export function sanitizeLeftRailViewChrome(value: unknown): LeftRailViewChrome {
  const record = isRecord(value) ? value : {}
  return {
    groupBy: record.groupBy === 'flat' ? 'flat' : 'workspace',
    orderBy: record.orderBy === 'manual' ? 'manual' : 'updated',
    groupExpansion: booleanMap(record.groupExpansion),
    sessionOrder: stringArrayMap(record.sessionOrder),
  }
}

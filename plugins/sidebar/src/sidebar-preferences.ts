import {
  INSPECTOR_PANEL_BUDGET,
} from '@dsh-studio/shared/panel-geometry'
import type { PreviewTabsMode } from '@dsh-studio/shared/workbench-contracts'

/** Whether the right-rail layout follows each project or one shared layout. */
export type LayoutScopeMode = 'workspace' | 'global'

export const SIDEBAR_MIN_WIDTH = INSPECTOR_PANEL_BUDGET.minSizePx
export const SIDEBAR_MAX_WIDTH = INSPECTOR_PANEL_BUDGET.maxSizePx
export const SIDEBAR_DEFAULT_WIDTH = INSPECTOR_PANEL_BUDGET.defaultSizePx
export const SIDEBAR_COLLAPSE_THRESHOLD_PX = INSPECTOR_PANEL_BUDGET.collapseThresholdPx
const SIDEBAR_LEGACY_MAX_WIDTH = 720
export const SIDEBAR_MAX_WORKSPACES = 50
export const SIDEBAR_MAX_TABS = 30

export interface PersistedSidebarTab {
  id: string
  type: string
  title: string
  resource?: string
  /** JSON-serializable custom state (the contract's `tab.meta`). */
  meta?: unknown
}

/** One project (workspace cwd) layout: the right rail + bottom workbench
 *  open-tab state. Keyed by the project cwd in `DesktopSidebarPreferences` —
 *  the sidebar is project-dimension, so two conversations of the same project
 *  share one layout and switching conversations never resets the panel. */
export interface PersistedWorkspaceLayout {
  activeId: string | null
  lastUsed: number
  /** This project's remembered rail width; falls back to `defaultWidth`. */
  width?: number
  tabs: PersistedSidebarTab[]
  /**
   * Tabs docked into the BOTTOM workbench (the second pane above the
   * terminal dock). Optional in the persisted document: legacy sessions
   * without the field parse to an empty workbench.
   */
  bottomTabs?: PersistedSidebarTab[]
  /** The active bottom-workbench tab id (null = nothing active there). */
  bottomActiveId?: string | null
}

export interface DesktopSidebarPreferences {
  defaultWidth: number
  openByDefault: boolean
  /** Per-project open-tab layouts keyed by the workspace cwd. */
  workspaces: Record<string, PersistedWorkspaceLayout>
  /** Plugin-owned settings blobs keyed by descriptor id (open map). */
  pluginSettings: Record<string, Record<string, unknown>>
  /**
   * Whether single-click center-surface opens create replaceable preview
   * tabs (`default`) or upgrade straight to permanent tabs (`disabled`).
   * Missing on legacy documents ⇒ parse falls back to `'default'`.
   */
  centerPreviewTabs: PreviewTabsMode
  /**
   * Whether the right-rail tab layout (and its remembered width) follows
   * each workspace cwd (`workspace`) or one shared bucket (`global`).
   * Missing on legacy documents ⇒ `'workspace'`.
   */
  layoutScope: LayoutScopeMode
}

export const DEFAULT_SIDEBAR_PREFERENCES: DesktopSidebarPreferences =
  Object.freeze({
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    openByDefault: false,
    workspaces: Object.freeze({}),
    pluginSettings: Object.freeze({}),
    centerPreviewTabs: 'default',
    layoutScope: 'workspace',
  }) as DesktopSidebarPreferences

function validKey(value: unknown, max = 160): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && !value.includes('\0')
}

/** JSON-serializable values only: primitives, finite numbers, arrays and
 *  plain objects (recursively). `undefined`, functions, symbols, NaN and
 *  class instances are rejected so persisted `meta` / plugin settings can
 *  never poison the localStorage document. */
const MAX_JSON_DEPTH = 6

function isJsonSafe(value: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH) return false
  if (value === null) return true
  switch (typeof value) {
    case 'boolean':
      return true
    case 'number':
      return Number.isFinite(value)
    case 'string':
      return true
    case 'object': {
      if (Array.isArray(value)) {
        return value.every(item => isJsonSafe(item, depth + 1))
      }
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) return false
      return Object.values(value).every(item => isJsonSafe(item, depth + 1))
    }
    default:
      return false
  }
}

function parseMeta(value: unknown): unknown | undefined {
  return value === undefined || isJsonSafe(value) ? value : undefined
}

function parseTab(value: unknown): PersistedSidebarTab | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const input = value as Record<string, unknown>
  if (!validKey(input.id) || !validKey(input.type, 120)) return undefined
  if (typeof input.title !== 'string' || input.title.length > 240) return undefined
  if (input.resource !== undefined
    && (typeof input.resource !== 'string' || input.resource.length > 4096
      || input.resource.includes('\0'))) return undefined
  const meta = parseMeta(input.meta)
  if (input.meta !== undefined && meta === undefined) return undefined
  return {
    id: input.id,
    type: input.type,
    title: input.title,
    ...(typeof input.resource === 'string' ? { resource: input.resource } : {}),
    ...(meta === undefined ? {} : { meta }),
  }
}

function parseWorkspace(value: unknown): PersistedWorkspaceLayout | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const input = value as Record<string, unknown>
  if (input.activeId !== null && !validKey(input.activeId)) return undefined
  if (!Number.isFinite(input.lastUsed) || Number(input.lastUsed) < 0) return undefined
  if (!Array.isArray(input.tabs) || input.tabs.length > SIDEBAR_MAX_TABS) {
    return undefined
  }
  const tabs: PersistedSidebarTab[] = []
  const ids = new Set<string>()
  for (const candidate of input.tabs) {
    const tab = parseTab(candidate)
    if (tab === undefined || ids.has(tab.id)) return undefined
    ids.add(tab.id)
    tabs.push(tab)
  }
  const activeId = input.activeId as string | null
  if (activeId !== null && !ids.has(activeId)) return undefined
  // The bottom workbench is optional: older layout records or malformed
  // extras resolve to an empty workbench instead of blocking the layout.
  const bottomTabs: PersistedSidebarTab[] = []
  const bottomIds = new Set<string>()
  if (Array.isArray(input.bottomTabs) && input.bottomTabs.length <= SIDEBAR_MAX_TABS) {
    for (const candidate of input.bottomTabs) {
      const tab = parseTab(candidate)
      if (tab === undefined || bottomIds.has(tab.id) || ids.has(tab.id)) return undefined
      bottomIds.add(tab.id)
      bottomTabs.push(tab)
    }
  }
  const bottomActiveId = input.bottomActiveId as string | null | undefined
  if (bottomActiveId !== null && bottomActiveId !== undefined
    && !bottomIds.has(bottomActiveId)) return undefined
  const width = input.width === undefined
    ? undefined
    : (typeof input.width === 'number' && Number.isFinite(input.width)
      ? clampSidebarWidth(input.width)
      : undefined)
  return {
    activeId,
    lastUsed: Number(input.lastUsed),
    tabs,
    bottomTabs,
    ...(bottomActiveId === undefined ? { bottomActiveId: null } : { bottomActiveId }),
    ...(width === undefined ? {} : { width }),
  }
}

export interface SidebarLayoutGeometry {
  viewportWidth: number
  leftWidth: number
  detailsWidth: number
}

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)),
  )
}

/**
 * Clamp the plugin rail to its own budget only.
 *
 * The window minWidth guarantees left max + right max always fit, so the
 * rail never needs a viewport-derived cap: both side panels can open at
 * any window size and the center absorbs whatever remains.
 */
export function clampSidebarWidthForLayout(value: number): number {
  return clampSidebarWidth(value)
}

function parsePluginSettings(
  value: unknown,
): Record<string, Record<string, unknown>> | undefined {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 120) return undefined
  const output: Record<string, Record<string, unknown>> = {}
  for (const [id, blob] of entries) {
    if (!validKey(id, 120)) return undefined
    if (typeof blob !== 'object' || blob === null || Array.isArray(blob)) {
      return undefined
    }
    const keys = Object.entries(blob as Record<string, unknown>)
    if (keys.length > 120) return undefined
    const parsed: Record<string, unknown> = {}
    for (const [key, item] of keys) {
      if (!validKey(key, 120)) return undefined
      if (!isJsonSafe(item)) return undefined
      parsed[key] = item
    }
    output[id] = parsed
  }
  return output
}

export function parseSidebarPreferences(
  value: unknown,
): DesktopSidebarPreferences | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const input = value as Record<string, unknown>
  if (typeof input.openByDefault !== 'boolean') {
    return undefined
  }
  if (typeof input.defaultWidth !== 'number'
    || !Number.isFinite(input.defaultWidth)
    || input.defaultWidth < SIDEBAR_MIN_WIDTH
    || input.defaultWidth > SIDEBAR_LEGACY_MAX_WIDTH) return undefined
  const pluginSettings = parsePluginSettings(input.pluginSettings)
  if (pluginSettings === undefined) return undefined
  if (typeof input.workspaces !== 'object' || input.workspaces === null
    || Array.isArray(input.workspaces)) return undefined
  const entries = Object.entries(input.workspaces as Record<string, unknown>)
  if (entries.length > SIDEBAR_MAX_WORKSPACES) return undefined
  const workspaces: Record<string, PersistedWorkspaceLayout> = {}
  for (const [cwd, rawWorkspace] of entries) {
    if (!validKey(cwd, 256)) return undefined
    const workspace = parseWorkspace(rawWorkspace)
    if (workspace === undefined) return undefined
    workspaces[cwd] = workspace
  }
  return {
    defaultWidth: clampSidebarWidth(input.defaultWidth),
    openByDefault: input.openByDefault,
    workspaces,
    pluginSettings,
    // Tolerant by design: legacy documents lack the fields and unknown
    // values fall back rather than rejecting the whole document.
    centerPreviewTabs: input.centerPreviewTabs === 'disabled' ? 'disabled' : 'default',
    layoutScope: input.layoutScope === 'global' ? 'global' : 'workspace',
  }
}

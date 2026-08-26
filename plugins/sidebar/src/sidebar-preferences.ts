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
/**
 * Live-cap policy: the rail may occupy at most this fraction of the window
 * width ({@link sidebarMaxWidth}). {@link SIDEBAR_MAX_WIDTH} remains as the
 * fallback cap for contexts without a viewport, so pure parsers and tests
 * keep a bounded range.
 */
export const SIDEBAR_MAX_VIEWPORT_RATIO = 0.75
/**
 * Viewport-independent sanity bound for PERSISTED widths. Document
 * validation must not depend on the current window: a width saved against a
 * larger display has to survive a later session on a smaller one
 * (non-destructive migration), so documents accept anything sane and the
 * live viewport cap applies when the width is read out instead.
 */
export const SIDEBAR_PERSISTED_MAX_WIDTH = 4096
export const SIDEBAR_MAX_WORKSPACES = 50
export const SIDEBAR_MAX_TABS = 30

/**
 * Version of the persisted right-sidebar layout document. Written as a
 * top-level `version` header on save and carried through read/write so a
 * future migration can branch on the stored layout semantics instead of
 * inferring them. Missing on legacy documents ⇒ treated as v1 (back-compat).
 */
export const SIDEBAR_LAYOUTS_VERSION = 2

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
 *  share one layout and switching conversations never resets the panel.
 *
 *  The BOTTOM workbench fields are RESTORED as dormant schema: the workbench
 *  is not mounted (product decision pending); the parser round-trips the
 *  persisted bottomTabs keys so legacy/manual documents keep their data until
 *  re-wiring lands. */
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
  // Per-entry tolerant parsing (F9): a single bad value never aborts the
  // whole workspace — bad tabs are dropped, a missing/invalid lastUsed and
  // activeId fall back instead of rejecting.
  const lastUsed = Number.isFinite(input.lastUsed) && Number(input.lastUsed) >= 0
    ? Number(input.lastUsed)
    : 0
  const tabs: PersistedSidebarTab[] = []
  const ids = new Set<string>()
  if (Array.isArray(input.tabs)) {
    // Truncate to the cap rather than reject a legacy over-limit document
    // (M2): keep the first SIDEBAR_MAX_TABS well-formed tabs so a 30+ tab
    // history never wipes the whole layout.
    for (const candidate of input.tabs.slice(0, SIDEBAR_MAX_TABS)) {
      if (tabs.length >= SIDEBAR_MAX_TABS) break
      const tab = parseTab(candidate)
      if (tab === undefined || ids.has(tab.id)) continue
      ids.add(tab.id)
      tabs.push(tab)
    }
  }
  const activeId = input.activeId as string | null | undefined
  const activeTabId = (activeId !== null && activeId !== undefined && ids.has(activeId))
    ? activeId
    : null
  // bottomTabs/bottomActiveId round-trip as dormant schema so persisted (or
  // hand-authored) documents keep the second-pane layout until the workbench
  // re-wires.
  const bottomTabs: PersistedSidebarTab[] = []
  const bottomIds = new Set<string>()
  if (Array.isArray(input.bottomTabs)) {
    for (const candidate of input.bottomTabs.slice(0, SIDEBAR_MAX_TABS)) {
      if (bottomTabs.length >= SIDEBAR_MAX_TABS) break
      const tab = parseTab(candidate)
      if (tab === undefined || bottomIds.has(tab.id) || ids.has(tab.id)) continue
      bottomIds.add(tab.id)
      bottomTabs.push(tab)
    }
  }
  const bottomActiveId = input.bottomActiveId as string | null | undefined
  const bottomActive = (bottomActiveId !== null && bottomActiveId !== undefined
    && bottomIds.has(bottomActiveId))
    ? bottomActiveId
    : (bottomActiveId === null ? null : undefined)
  const width = input.width === undefined
    ? undefined
    : (typeof input.width === 'number' && Number.isFinite(input.width)
      ? clampPersistedWidth(input.width)
      : undefined)
  return {
    activeId: activeTabId,
    lastUsed,
    tabs,
    bottomTabs,
    ...(bottomActive === undefined ? {} : { bottomActiveId: bottomActive }),
    ...(width === undefined ? {} : { width }),
  }
}

export interface SidebarLayoutGeometry {
  viewportWidth: number
  leftWidth: number
  detailsWidth: number
}

/**
 * Effective live maximum rail width: the viewport ratio when a window width
 * is known, otherwise the static budget cap (pure / non-DOM contexts).
 */
export function sidebarMaxWidth(viewportWidth?: number): number {
  if (viewportWidth === undefined || !Number.isFinite(viewportWidth)
    || viewportWidth <= 0) return SIDEBAR_MAX_WIDTH
  return Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.round(viewportWidth * SIDEBAR_MAX_VIEWPORT_RATIO),
  )
}

export function clampSidebarWidth(value: number, viewportWidth?: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(
    sidebarMaxWidth(viewportWidth),
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)),
  )
}

/** Persisted-document bound (no viewport): the parse/clone-time defense. */
export function clampPersistedWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(
    SIDEBAR_PERSISTED_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)),
  )
}

function parsePluginSettings(
  value: unknown,
): Record<string, Record<string, unknown>> | undefined {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  // Per-entry tolerant: keep well-formed plugin blobs, drop malformed ones and
  // cap the count — a corrupt blob never rejects the whole preferences doc.
  const output: Record<string, Record<string, unknown>> = {}
  const entries = Object.entries(value as Record<string, unknown>)
  for (const [id, blob] of entries) {
    if (Object.keys(output).length >= 120) break
    if (!validKey(id, 120)) continue
    if (typeof blob !== 'object' || blob === null || Array.isArray(blob)) continue
    const parsed: Record<string, unknown> = {}
    const keys = Object.entries(blob as Record<string, unknown>)
    for (const [key, item] of keys) {
      if (Object.keys(parsed).length >= 120) break
      if (!validKey(key, 120)) continue
      if (!isJsonSafe(item)) continue
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
    || input.defaultWidth > SIDEBAR_PERSISTED_MAX_WIDTH) return undefined
  const pluginSettings = parsePluginSettings(input.pluginSettings)
  if (pluginSettings === undefined) return undefined
  // Per-entry tolerant (F9/M2): parse every well-formed workspace entry and
  // keep it; drop malformed ones and cap the count. One bad project layout
  // (or a legacy over-limit document) must never wipe every project's tabs,
  // widths and commit drafts — migration stays non-destructive. The optional
  // `version` header is informational and ignored here; the persistence layer
  // re-stamps the current SIDEBAR_LAYOUTS_VERSION on every read/write.
  const workspaces: Record<string, PersistedWorkspaceLayout> = {}
  if (typeof input.workspaces === 'object' && input.workspaces !== null
    && !Array.isArray(input.workspaces)) {
    const entries = Object.entries(input.workspaces as Record<string, unknown>)
    for (const [cwd, rawWorkspace] of entries) {
      if (Object.keys(workspaces).length >= SIDEBAR_MAX_WORKSPACES) break
      if (!validKey(cwd, 256)) continue
      const workspace = parseWorkspace(rawWorkspace)
      if (workspace === undefined) continue
      workspaces[cwd] = workspace
    }
  }
  return {
    defaultWidth: clampPersistedWidth(input.defaultWidth),
    openByDefault: input.openByDefault,
    workspaces,
    pluginSettings,
    // Tolerant by design: legacy documents lack the fields and unknown
    // values fall back rather than rejecting the whole document.
    centerPreviewTabs: input.centerPreviewTabs === 'disabled' ? 'disabled' : 'default',
    layoutScope: input.layoutScope === 'global' ? 'global' : 'workspace',
  }
}

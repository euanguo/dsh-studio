/**
 * Shared left-rail settings vocabulary (namespace + versioned DTO + icon
 * preference + sanitizers), consumed by BOTH halves:
 *   - the host (sidebar-host) registers a schemastery schema over these
 *     values and migrates legacy state into the namespace;
 *   - the client (desktop-left-rail) reads/writes the slice through the
 *     /sidebar settings routes and sanitizes on hydrate.
 * Kept free of schemastery so the browser bundle never pulls the schema
 * runtime in (same rule as prefs-shared.ts).
 */

/**
 * The user-settings namespace holding the left-rail view slice. Matches the
 * DSH settings namespace pattern (`^[a-z][a-z0-9-]*$` — no dots), unlike the
 * fictional `dsh-studio.left-rail` the client used to send (which the host
 * routes ignored).
 */
export const LEFT_RAIL_SETTINGS_NS = 'dsh-studio-left-rail'

/** Current DTO version of the durable slice (for one-way migrations). */
export const LEFT_RAIL_SETTINGS_VERSION = 1

/**
 * Built-in names are persisted as data, so the allowlist lives here in the
 * shared vocabulary (not client-only). The order is the picker grid order.
 */
export const PROJECT_ICON_BUILTINS = [
  'folder', 'git', 'code', 'terminal', 'files', 'list', 'web', 'adjustments',
] as const
export type ProjectIconBuiltin = typeof PROJECT_ICON_BUILTINS[number]

/** A user-chosen project icon override (explicit builtin or uploaded PNG). */
export interface ProjectIconPreference {
  readonly kind: 'builtin' | 'upload'
  readonly name?: ProjectIconBuiltin
  readonly mime?: 'image/png'
  readonly data?: string
}

/** The durable left-rail view slice (JSON-compatible, versioned). */
export interface LeftRailSettings {
  /** DTO version; guides one-way migrations on read. */
  readonly version?: number
  readonly activeTab?: string
  readonly projectGroup?: Record<string, string>
  readonly groupIds?: string[]
  readonly groupLabels?: Record<string, string>
  readonly projectAlias?: Record<string, string>
  /** worktreePath → user alias (display name overriding the basename/branch). */
  readonly worktreeAlias?: Record<string, string>
  /**
   * repoRoot → explicit icon preference; absence (or an end-of-parse empty
   * map) means auto-resolve. Auto-detected icons are never persisted.
   */
  readonly projectIconOverrides?: Record<string, ProjectIconPreference>
}

/** The keys a stored `LeftRailSettings` slice may carry (migration + sanity). */
export const LEFT_RAIL_SETTINGS_KEYS = [
  'version', 'activeTab', 'projectGroup', 'groupIds', 'groupLabels',
  'projectAlias', 'worktreeAlias', 'projectIconOverrides',
] as const

/** Validate persisted icon intent at the settings boundary. */
export function sanitizeProjectIconPreference(value: unknown): ProjectIconPreference | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.kind === 'builtin' && typeof record.name === 'string'
    && (PROJECT_ICON_BUILTINS as readonly string[]).includes(record.name)) {
    return { kind: 'builtin', name: record.name as ProjectIconBuiltin }
  }
  if (record.kind === 'upload' && record.mime === 'image/png' && typeof record.data === 'string'
    && record.data.length <= 400 * 1024
    && /^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/i.test(record.data)) {
    return { kind: 'upload', mime: 'image/png', data: record.data }
  }
  return undefined
}

/**
 * Sanitize a raw stored section into a well-formed LeftRailSettings slice:
 * unknown keys are dropped, every known field is re-validated, and an empty
 * projectIconOverrides collapses to `{}` (auto for every project). Returns
 * undefined when the input is not a plain object.
 */
export function sanitizeLeftRailSettings(value: unknown): LeftRailSettings | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const out: {
    version?: number
    activeTab?: string
    projectGroup?: Record<string, string>
    groupIds?: string[]
    groupLabels?: Record<string, string>
    projectAlias?: Record<string, string>
    worktreeAlias?: Record<string, string>
    projectIconOverrides?: Record<string, ProjectIconPreference>
  } = {}
  if (typeof record.version === 'number' && Number.isInteger(record.version) && record.version >= 0) {
    out.version = record.version
  }
  if (typeof record.activeTab === 'string' && record.activeTab !== '') {
    out.activeTab = record.activeTab
  }
  if (isStringRecord(record.projectGroup)) out.projectGroup = { ...record.projectGroup }
  if (Array.isArray(record.groupIds)) {
    const ids = record.groupIds.filter((id): id is string => typeof id === 'string' && id !== '')
    if (ids.length > 0) out.groupIds = ids
  }
  if (isStringRecord(record.groupLabels)) out.groupLabels = { ...record.groupLabels }
  if (isStringRecord(record.projectAlias)) out.projectAlias = { ...record.projectAlias }
  if (isStringRecord(record.worktreeAlias)) out.worktreeAlias = { ...record.worktreeAlias }
  if (record.projectIconOverrides !== undefined) {
    const overrides = record.projectIconOverrides
    if (typeof overrides === 'object' && overrides !== null && !Array.isArray(overrides)) {
      const outOverrides: Record<string, ProjectIconPreference> = {}
      for (const [root, preference] of Object.entries(overrides as Record<string, unknown>)) {
        const sanitized = sanitizeProjectIconPreference(preference)
        if (sanitized !== undefined) outOverrides[root] = sanitized
      }
      // Preserve an explicit empty dict (all-auto) as present, so a reset
      // that removed the last override stays a real (empty) override map.
      out.projectIconOverrides = outOverrides
    }
  }
  return out
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every(item => typeof item === 'string')
}

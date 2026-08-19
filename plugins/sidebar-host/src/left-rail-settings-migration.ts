/**
 * One-way, idempotent migration of the left-rail view slice out of the
 * `dsh-better-sidebar` namespace (where it historically rode along, untyped,
 * with the side card prefs) into its own `oh-dsh-left-rail` namespace.
 *
 * Motivation: before this change the left-rail wrote its slice through the
 * same merge-only settings route as the sidebar prefs, so (a) the slice had
 * no schema/version of its own and (b) deletions could never persist (merge
 * cannot remove keys). The target namespace owns a versioned DTO and the
 * client writes it through section `replace`/`mutate` so resets survive.
 *
 * When this runs:
 *   - after the host registers both namespaces, once per boot;
 *   - only when `dsh-better-sidebar` still carries left-rail keys AND the
 *     `oh-dsh-left-rail` namespace is not yet populated (idempotent);
 *   - non-destructively: the slice is copied (sanitized, version-stamped)
 *     into the target, then only the moved keys are removed from the sidebar
 *     section via path `unset` — the sidebar's own prefs are untouched.
 *   - restart-safe: a crash between copy and unset re-runs the copy next
 *     boot (same values, replace is idempotent); the unset always follows.
 */
import {
  LEFT_RAIL_SETTINGS_KEYS,
  LEFT_RAIL_SETTINGS_NS,
  LEFT_RAIL_SETTINGS_VERSION,
  sanitizeLeftRailSettings,
} from '@oh-dsh/shared/left-rail-preferences'
import { SIDEBAR_PREFS_NS } from '@oh-dsh/shared/prefs-shared'

/** The minimal settings seam this migration needs (real seam: ctx.settings). */
export interface LeftRailMigrationSeam {
  /** Read one namespace's raw stored user section (or undefined when absent). */
  describe(ns: string): { user?: unknown; revision?: number }
  /** Wholesale replace of one namespace's user section. */
  replace(ns: string, section: object): Promise<void>
  /** Path-addressed unset edits on one namespace. */
  mutate(ns: string, ops: ReadonlyArray<{ op: 'unset'; path: string[] }>): Promise<void>
}

/** Collect the left-rail keys present in a raw stored section. */
function leftRailSliceOf(section: unknown): Record<string, unknown> | undefined {
  if (typeof section !== 'object' || section === null || Array.isArray(section)) return undefined
  const record = section as Record<string, unknown>
  const slice: Record<string, unknown> = {}
  for (const key of LEFT_RAIL_SETTINGS_KEYS) {
    if (record[key] !== undefined) slice[key] = record[key]
  }
  return Object.keys(slice).length === 0 ? undefined : slice
}

/**
 * Migrate a left-rail slice that was stored under `dsh-better-sidebar` into
 * its own namespace. Returns true when a migration happened, false otherwise.
 */
export async function migrateLegacyLeftRailSlice(seam: LeftRailMigrationSeam): Promise<boolean> {
  const sidebar = seam.describe(SIDEBAR_PREFS_NS)
  const legacy = leftRailSliceOf(sidebar.user)
  if (legacy === undefined) return false

  // The target must not already hold a slice — never clobber fresh state.
  const target = seam.describe(LEFT_RAIL_SETTINGS_NS)
  if (hasContent(target.user)) return false

  const sanitized = sanitizeLeftRailSettings({ ...legacy, version: LEFT_RAIL_SETTINGS_VERSION })
  if (sanitized === undefined) return false

  await seam.replace(LEFT_RAIL_SETTINGS_NS, sanitized)
  const unsetOps = Object.keys(legacy)
    .filter(key => key !== 'version')
    .map(key => ({ op: 'unset' as const, path: [key] }))
  if (unsetOps.length > 0) {
    await seam.mutate(SIDEBAR_PREFS_NS, unsetOps)
  }
  return true
}

/** Whether a raw section carries any left-rail-keys shape (not blank/absent). */
function hasContent(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.keys(value as Record<string, unknown>).length > 0
}

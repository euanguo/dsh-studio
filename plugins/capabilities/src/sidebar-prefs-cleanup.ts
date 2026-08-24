/**
 * One-way cleanup of sidebar prefs that were REMOVED from the schema.
 *
 * Older profiles can still carry `openByDefault`, `defaultWidthPercent`,
 * `bottomPanelAutoTerminal` and `browserNoSandbox` under the
 * `dsh-better-sidebar` namespace. Nothing reads them anymore — the sidebar
 * layout half lives in the client localStorage store and the terminal dock
 * was removed — but unsetting them keeps the settings document honest.
 *
 * Idempotent: only keys actually present in the stored section are unset,
 * an absent/malformed section is a no-op, and unsetting a missing key on a
 * later boot is harmless. Failure is contained by the caller (a write hiccup
 * retries next boot; the orphan keys are ignored meanwhile).
 */
import { SIDEBAR_PREFS_NS } from '@dsh-studio/shared/prefs-shared'

/** The sidebar prefs keys removed from `PrefsSchema` (nothing reads them). */
export const LEGACY_SIDEBAR_PREF_KEYS = [
  'openByDefault',
  'defaultWidthPercent',
  'bottomPanelAutoTerminal',
  'browserNoSandbox',
] as const

/** The minimal settings seam this cleanup needs (real seam: ctx.settings). */
export interface SidebarPrefsCleanupSeam {
  /** Read one namespace's raw stored user section (or undefined when absent). */
  describe(ns: string): { user?: unknown; revision?: number }
  /** Path-addressed unset edits on one namespace. */
  mutate(ns: string, ops: ReadonlyArray<{ op: 'unset'; path: string[] }>): Promise<void>
}

/** Unset any removed sidebar prefs still present. Returns true when it wrote. */
export async function cleanupLegacySidebarPrefs(seam: SidebarPrefsCleanupSeam): Promise<boolean> {
  const sidebar = seam.describe(SIDEBAR_PREFS_NS)
  const record = sidebar.user
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return false
  const present = LEGACY_SIDEBAR_PREF_KEYS.filter(
    key => (record as Record<string, unknown>)[key] !== undefined,
  )
  if (present.length === 0) return false
  await seam.mutate(
    SIDEBAR_PREFS_NS,
    present.map(key => ({ op: 'unset' as const, path: [key] })),
  )
  return true
}
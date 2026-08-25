/**
 * Left-rail view state, persisted through the desktop host's settings service
 * into its OWN `dsh-studio-left-rail` namespace (→ the profile settings document),
 * NOT browser localStorage and NOT the sidebar prefs section. The slice is a
 * versioned DTO; writes go through whole-section `settings.replace` (plus
 * schema-backed load) so deletions — icon reset to auto, alias clear, group
 * unassign — survive reloads. projects/worktrees themselves stay derived
 * from git. See docs/persistence-architecture.md (decision B).
 */
import { callCapabilitiesGlobalApi } from '@dsh-studio/shared/capabilities-api'
import {
  LEFT_RAIL_SETTINGS_NS,
  LEFT_RAIL_SETTINGS_VERSION,
  sanitizeLeftRailSettings,
  type LeftRailSettings,
} from '@dsh-studio/shared/left-rail-preferences'

export type { LeftRailSettings } from '@dsh-studio/shared/left-rail-preferences'

/** A settings response envelope (namespace value + revision for CAS). */
export interface LeftRailSettingsView {
  value: LeftRailSettings
  revision: number
}

/** Read the persisted slice (empty DTO + revision when absent), sanitized. */
export async function loadLeftRailSettings(signal?: AbortSignal): Promise<LeftRailSettingsView> {
  const result = await callCapabilitiesGlobalApi<{ value?: unknown; revision?: number }>(
    'settings.get',
    { ns: LEFT_RAIL_SETTINGS_NS },
    signal,
  )
  return {
    value: sanitizeLeftRailSettings(result.value) ?? {},
    revision: result.revision ?? 0,
  }
}

/**
 * Persist the complete next slice (CAS on the last known revision). This is a
 * WHOLE-SECTION replace, not a merge: keys absent from `section` are removed
 * from the stored slice, so every deletion the store expresses lands on disk.
 */
export async function saveLeftRailSettings(
  section: LeftRailSettings,
  expectedRevision?: number,
): Promise<LeftRailSettingsView> {
  const result = await callCapabilitiesGlobalApi<{ value?: unknown; revision?: number }>(
    'settings.replace',
    {
      ns: LEFT_RAIL_SETTINGS_NS,
      section: { ...section, version: LEFT_RAIL_SETTINGS_VERSION },
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    },
  )
  return {
    value: sanitizeLeftRailSettings(result.value) ?? {},
    revision: result.revision ?? 0,
  }
}

/**
 * Persist the complete next slice with CAS and one self-healing retry. On a
 * conflict (another surface wrote meanwhile) or a transport failure the
 * latest slice is re-read and the write retried once over THAT base — a
 * conflict never wedges persistence until reload and never reverts another
 * surface's keys with a stale copy. A second failure is propagated to the
 * caller (never silently swallowed) so the surface can surface it.
 * @param base - the caller's last-known slice for the first attempt.
 * @param revision - the caller's last-known revision for the first attempt.
 * @param build - derive the next slice from a base (used on the retry too).
 * @returns the accepted view; the caller adopts its value + revision.
 */
export async function withSettingsCas(
  base: LeftRailSettings,
  revision: number,
  build: (nextBase: LeftRailSettings) => LeftRailSettings,
): Promise<LeftRailSettingsView> {
  try {
    return await saveLeftRailSettings(build(base), revision)
  } catch {
    const latest = await loadLeftRailSettings()
    return saveLeftRailSettings(build(latest.value), latest.revision)
  }
}

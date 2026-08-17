/**
 * Left-rail grouping settings, persisted through the desktop host's settings
 * service (`oh-dsh.left-rail` namespace → profile JSON file), the same channel
 * as the sidebar preferences — NOT browser localStorage. The grouping is view
 * state (tab/group/alias), while projects/worktrees stay derived from git.
 */
import { callSidebarGlobalApi } from '@oh-dsh/shared/sidebar-api'

const NS = 'oh-dsh.left-rail'

/** The durable left-rail view slice (JSON-compatible). */
export interface LeftRailSettings {
  activeTab?: string
  projectGroup?: Record<string, string>
  groupIds?: string[]
  groupLabels?: Record<string, string>
  projectAlias?: Record<string, string>
}

/** A settings response envelope (namespace value + revision for CAS). */
export interface LeftRailSettingsView {
  value: LeftRailSettings
  revision: number
}

/** Read the persisted grouping (value empty object + revision when absent). */
export async function loadLeftRailSettings(signal?: AbortSignal): Promise<LeftRailSettingsView> {
  const result = await callSidebarGlobalApi<{ value?: LeftRailSettings; revision?: number }>(
    'settings.get',
    { ns: NS },
    signal,
  )
  return { value: result.value ?? {}, revision: result.revision ?? 0 }
}

/** Persist a grouping patch (CAS on the last known revision). */
export async function saveLeftRailSettings(
  patch: LeftRailSettings,
  expectedRevision?: number,
): Promise<LeftRailSettingsView> {
  const result = await callSidebarGlobalApi<{ value?: LeftRailSettings; revision?: number }>(
    'settings.update',
    {
      ns: NS,
      patch,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    },
  )
  return { value: result.value ?? {}, revision: result.revision ?? 0 }
}

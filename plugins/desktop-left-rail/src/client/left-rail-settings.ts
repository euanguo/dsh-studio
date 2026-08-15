/**
 * Left-rail grouping settings, persisted through the desktop host's settings
 * service (`oh-dsh.left-rail` namespace → profile JSON file), the same channel
 * as the sidebar preferences — NOT browser localStorage. The grouping is view
 * state (tab/group/alias), while projects/worktrees stay derived from git.
 */
const NS = 'oh-dsh.left-rail'
const API_ROOT = '/sidebar/api/'

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

async function call(method: string, payload: unknown, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(`${API_ROOT}${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    ...(signal === undefined ? {} : { signal }),
  })
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string }; value?: unknown }
  if (!response.ok || body.ok === false) {
    throw new Error(body.error?.message ?? `left-rail settings ${method} failed (${response.status})`)
  }
  return body.value
}

/** Read the persisted grouping (value empty object + revision when absent). */
export async function loadLeftRailSettings(signal?: AbortSignal): Promise<LeftRailSettingsView> {
  const value = (await call('settings.get', { ns: NS }, signal)) as { value?: LeftRailSettings; revision?: number }
  return { value: value.value ?? {}, revision: value.revision ?? 0 }
}

/** Persist a grouping patch (CAS on the last known revision). */
export async function saveLeftRailSettings(
  patch: LeftRailSettings,
  expectedRevision?: number,
): Promise<LeftRailSettingsView> {
  const value = (await call('settings.update', {
    ns: NS,
    patch,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  })) as { value?: LeftRailSettings; revision?: number }
  return { value: value.value ?? {}, revision: value.revision ?? 0 }
}

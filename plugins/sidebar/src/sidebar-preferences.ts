export const SIDEBAR_MIN_WIDTH = 280
export const SIDEBAR_MAX_WIDTH = 480
export const SIDEBAR_DEFAULT_WIDTH = 300
const SIDEBAR_LEGACY_MAX_WIDTH = 720
export const SIDEBAR_MAX_SESSIONS = 50
export const SIDEBAR_MAX_TABS = 30

export interface PersistedSidebarTab {
  id: string
  type: string
  title: string
  resource?: string
}

export interface PersistedSidebarSession {
  activeId: string | null
  lastUsed: number
  tabs: PersistedSidebarTab[]
}

export interface DesktopSidebarPreferences {
  defaultWidth: number
  openByDefault: boolean
  sessions: Record<string, PersistedSidebarSession>
  tabsEnabled: Record<string, boolean>
  viewersEnabled: Record<string, boolean>
  version: 1
}

export const DEFAULT_SIDEBAR_PREFERENCES: DesktopSidebarPreferences =
  Object.freeze({
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    openByDefault: false,
    sessions: Object.freeze({}),
    tabsEnabled: Object.freeze({}),
    viewersEnabled: Object.freeze({}),
    version: 1,
  }) as DesktopSidebarPreferences

function validKey(value: unknown, max = 160): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && !value.includes('\0')
}

function parseEnabledMap(value: unknown): Record<string, boolean> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > 120) return undefined
  const output: Record<string, boolean> = {}
  for (const [key, enabled] of entries) {
    if (!validKey(key, 120) || typeof enabled !== 'boolean') return undefined
    output[key] = enabled
  }
  return output
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
  return {
    id: input.id,
    type: input.type,
    title: input.title,
    ...(typeof input.resource === 'string' ? { resource: input.resource } : {}),
  }
}

function parseSession(value: unknown): PersistedSidebarSession | undefined {
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
  return { activeId, lastUsed: Number(input.lastUsed), tabs }
}

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)),
  )
}

export function parseSidebarPreferences(
  value: unknown,
): DesktopSidebarPreferences | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const input = value as Record<string, unknown>
  if (input.version !== 1 || typeof input.openByDefault !== 'boolean') {
    return undefined
  }
  if (typeof input.defaultWidth !== 'number'
    || !Number.isFinite(input.defaultWidth)
    || input.defaultWidth < SIDEBAR_MIN_WIDTH
    || input.defaultWidth > SIDEBAR_LEGACY_MAX_WIDTH) return undefined
  const tabsEnabled = parseEnabledMap(input.tabsEnabled)
  const viewersEnabled = parseEnabledMap(input.viewersEnabled)
  if (tabsEnabled === undefined || viewersEnabled === undefined) return undefined
  if (typeof input.sessions !== 'object' || input.sessions === null
    || Array.isArray(input.sessions)) return undefined
  const entries = Object.entries(input.sessions as Record<string, unknown>)
  if (entries.length > SIDEBAR_MAX_SESSIONS) return undefined
  const sessions: Record<string, PersistedSidebarSession> = {}
  for (const [sessionId, rawSession] of entries) {
    if (!validKey(sessionId, 256)) return undefined
    const session = parseSession(rawSession)
    if (session === undefined) return undefined
    sessions[sessionId] = session
  }
  return {
    defaultWidth: clampSidebarWidth(input.defaultWidth),
    openByDefault: input.openByDefault,
    sessions,
    tabsEnabled,
    viewersEnabled,
    version: 1,
  }
}

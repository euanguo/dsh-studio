import {
  sidebarApi,
  type CapabilitiesSettingsView,
} from './sidebar-api.ts'

/**
 * Host-synced FEATURE preferences (the Side card namespace). These ride the
 * host settings service through /capabilities/api settings.* so they follow the
 * user across browsers and surfaces — the OTHER half of the sidebar's
 * deliberate two-store split; UI chrome layouts stay in the domain-backed
 * sidebar storage (see the store-boundary note there).
 */

export interface SidebarRuntimePreferences {
  agentTerminalTools: boolean
  /**
   * Whether model-facing WorkTree topology/lifecycle tools are injected.
   * The delegation half rides its own switch
   * ({@link agentWorktreeDelegationTools}).
   */
  agentWorktreeTools: boolean
  /**
   * Whether model-facing WorkTree delegation tools (worktree_delegate and
   * its status / wait / stop / result) are injected — the cross-project
   * conversation scheduling half of the WorkTree family. Separate from
   * {@link agentWorktreeTools}, so inspection and scheduling grant (or
   * withhold) independently.
   */
  agentWorktreeDelegationTools: boolean
  /**
   * Whether the sidebar auto-activates (opens the panel) and expands the
   * subagent page when the current conversation spawns a new subagent.
   */
  autoOpenSubagent: boolean
  /**
   * Whether the sidebar auto-activates (opens the panel) and expands the
   * Jobs page when a NEW background job appears for the current
   * conversation (any new job id, not just the first one).
   */
  autoOpenJobs: boolean
  /** Open maps: absent tab/viewer ids are enabled by default. */
  tabsEnabled: Record<string, boolean>
  viewersEnabled: Record<string, boolean>
  browserInterceptLinks: boolean
  /**
   * Whether plain http EXTERNAL link clicks open in the sidebar browser
   * instead of the system browser. On by default; gated on the
   * `browserInterceptLinks` master and the target tab's enable switch.
   */
  browserInterceptHttp: boolean
  /**
   * Whether plain https EXTERNAL link clicks open in the sidebar browser
   * instead of the system browser. OFF by default — most https sites
   * refuse iframe embedding, so the system browser is the smoother default.
   */
  browserInterceptHttps: boolean
  /**
   * Whether the HTML previewer drops its sandboxed iframe. Sandbox ON (the
   * default) renders previewed HTML in an opaque-origin iframe that cannot
   * touch the GUI; turning it OFF runs the previewed page with the GUI's
   * own origin — full read/write access to session files and internal
   * APIs. Only for trusted local content; the setting copy warns.
   */
  htmlViewerNoSandbox: boolean
  /**
   * Whether a newly opened HTML preview starts UNSANDBOXED (the per-surface
   * temporary unlock pre-applied). Off by default: previews open sandboxed
   * and the status row offers the one-tap unlock; when on, previews open
   * in the red unsandboxed state and the status row offers a one-tap
   * restore for the current file.
   */
  htmlViewerDefaultUnsafe: boolean
  /**
   * Custom terminal font-family stack (a CSS font-family value, e.g.
   * `'JetBrains Mono', monospace`). Empty string follows the dock's theme
   * font. Applied live to the active terminal dock.
   */
  terminalFontFamily: string
  /**
   * Custom terminal font size in px (9–32, clamped). Applied live to the
   * active terminal dock.
   */
  terminalFontSize: number
  /**
   * Explicit shell executable for the sidebar terminals (UI tabs + agent
   * tools). Empty follows the resolution chain (deployment `shell` config →
   * this setting → `DSH_SIDEBAR_SHELL` → platform probe/login-chain →
   * fallback); takes effect for NEW terminals.
   */
  terminalShell: string
  /** Max scrollback rows for terminal tabs (1000–50000). */
  terminalScrollbackRows: number
  /** How long a tab switch preserves the shell in ms (0–120000). */
  terminalReconnectGraceMs: number
  /** SIGTERM→SIGKILL escalation delay in ms (250–10000). */
  terminalProcessKillGraceMs: number
  /** Maximum retained inactive sessions (0–1024). */
  terminalRetainedInactiveSessions: number
  /** Mouse wheel multiplier applied to terminal wheel events (0.25–4). */
  terminalMouseWheelMultiplier: number
  /** Enable optional ligature rendering when the addon is available. */
  terminalLigatures: boolean
  /** GPU renderer policy: automatic, forced on, or forced off. */
  terminalGpuAcceleration: 'auto' | 'on' | 'off'
  interceptOpenPath: boolean
}

export const DEFAULT_SIDEBAR_RUNTIME_PREFERENCES:
Readonly<SidebarRuntimePreferences> = Object.freeze({
  agentTerminalTools: false,
  agentWorktreeTools: false,
  agentWorktreeDelegationTools: false,
  autoOpenSubagent: true,
  autoOpenJobs: true,
  tabsEnabled: {},
  viewersEnabled: {},
  browserInterceptLinks: true,
  browserInterceptHttp: true,
  browserInterceptHttps: false,
  htmlViewerNoSandbox: false,
  htmlViewerDefaultUnsafe: false,
  terminalFontFamily: '',
  terminalFontSize: 13,
  terminalShell: '',
  terminalScrollbackRows: 5_000,
  terminalReconnectGraceMs: 30_000,
  terminalProcessKillGraceMs: 1_500,
  terminalRetainedInactiveSessions: 128,
  terminalMouseWheelMultiplier: 1,
  terminalLigatures: false,
  terminalGpuAcceleration: 'auto',
  interceptOpenPath: true,
})

export interface SidebarRuntimeSettingsSnapshot {
  busy: boolean
  error: 'load' | 'save' | null
  preferences: Readonly<SidebarRuntimePreferences>
  revision: number | undefined
}

interface SidebarRuntimeSettingsApi {
  settingsGet(signal?: AbortSignal): Promise<CapabilitiesSettingsView>
  settingsUpdate(
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<CapabilitiesSettingsView>
}

/**
 * Field-driven parse table (F13): ONE place declaring every preference's
 * shape, its fallback, and its bounds. Both the defaults object above and
 * {@link parseSidebarRuntimePreferences} below are derived from it — adding
 * a preference touches this table (and the interface) only, never three
 * places. Semantics are preserved: booleans require `typeof === 'boolean'`,
 * strings require a string, numbers are floored and clamped to [min,max],
 * enums only accept listed values, and the two enable maps keep boolean
 * entries only.
 */
type FieldSpec =
  | { key: keyof SidebarRuntimePreferences; kind: 'boolean' }
  | { key: keyof SidebarRuntimePreferences; kind: 'string' }
  | { key: keyof SidebarRuntimePreferences; kind: 'number'; min: number; max: number }
  | { key: keyof SidebarRuntimePreferences; kind: 'enum'; values: readonly string[] }
  | { key: keyof SidebarRuntimePreferences; kind: 'booleanMap' }

const FIELD_SPECS: readonly FieldSpec[] = [
  { key: 'agentTerminalTools', kind: 'boolean' },
  { key: 'agentWorktreeTools', kind: 'boolean' },
  { key: 'agentWorktreeDelegationTools', kind: 'boolean' },
  { key: 'autoOpenSubagent', kind: 'boolean' },
  { key: 'autoOpenJobs', kind: 'boolean' },
  { key: 'tabsEnabled', kind: 'booleanMap' },
  { key: 'viewersEnabled', kind: 'booleanMap' },
  { key: 'browserInterceptLinks', kind: 'boolean' },
  { key: 'browserInterceptHttp', kind: 'boolean' },
  { key: 'browserInterceptHttps', kind: 'boolean' },
  { key: 'htmlViewerNoSandbox', kind: 'boolean' },
  { key: 'htmlViewerDefaultUnsafe', kind: 'boolean' },
  { key: 'terminalFontFamily', kind: 'string' },
  { key: 'terminalFontSize', kind: 'number', min: 9, max: 32 },
  { key: 'terminalShell', kind: 'string' },
  { key: 'terminalScrollbackRows', kind: 'number', min: 1_000, max: 50_000 },
  { key: 'terminalReconnectGraceMs', kind: 'number', min: 0, max: 120_000 },
  { key: 'terminalProcessKillGraceMs', kind: 'number', min: 250, max: 10_000 },
  { key: 'terminalRetainedInactiveSessions', kind: 'number', min: 0, max: 1_024 },
  { key: 'terminalMouseWheelMultiplier', kind: 'number', min: 0.25, max: 4 },
  { key: 'terminalLigatures', kind: 'boolean' },
  { key: 'terminalGpuAcceleration', kind: 'enum', values: ['auto', 'on', 'off'] },
  { key: 'interceptOpenPath', kind: 'boolean' },
]

function booleanMapPreference(record: Record<string, unknown>, key: string): Record<string, boolean> {
  const value = record[key]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter(
    (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
  ))
}

function parseField(
  spec: FieldSpec,
  record: Record<string, unknown>,
  fallbacks: Readonly<SidebarRuntimePreferences>,
): SidebarRuntimePreferences[keyof SidebarRuntimePreferences] {
  const raw = record[spec.key]
  if (spec.kind === 'booleanMap') {
    return booleanMapPreference(record, spec.key) as SidebarRuntimePreferences[keyof SidebarRuntimePreferences]
  }
  if (spec.kind === 'boolean') {
    return (typeof raw === 'boolean' ? raw : fallbacks[spec.key]) as SidebarRuntimePreferences[keyof SidebarRuntimePreferences]
  }
  if (spec.kind === 'string') {
    return (typeof raw === 'string' ? raw : fallbacks[spec.key]) as SidebarRuntimePreferences[keyof SidebarRuntimePreferences]
  }
  if (spec.kind === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallbacks[spec.key]
    return Math.min(spec.max, Math.max(spec.min, Math.floor(raw))) as SidebarRuntimePreferences[keyof SidebarRuntimePreferences]
  }
  // enum
  if (typeof raw === 'string' && spec.values.some(v => v === raw)) return raw as SidebarRuntimePreferences[keyof SidebarRuntimePreferences]
  return fallbacks[spec.key]
}

export function parseSidebarRuntimePreferences(
  value: unknown,
): SidebarRuntimePreferences {
  const record = value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  const defaults = DEFAULT_SIDEBAR_RUNTIME_PREFERENCES
  const out = {} as Record<string, unknown>
  for (const spec of FIELD_SPECS) {
    out[spec.key] = parseField(spec, record, defaults)
  }
  return out as unknown as SidebarRuntimePreferences
}

function snapshotFromView(
  view: CapabilitiesSettingsView,
): SidebarRuntimeSettingsSnapshot {
  return {
    busy: false,
    error: null,
    preferences: parseSidebarRuntimePreferences(view.value),
    revision: view.revision,
  }
}

export class SidebarRuntimeSettingsService {
  private readonly listeners = new Set<() => void>()
  private queue: Promise<unknown> = Promise.resolve()
  private readonly api: SidebarRuntimeSettingsApi
  private snapshot: SidebarRuntimeSettingsSnapshot = {
    busy: true,
    error: null,
    preferences: { ...DEFAULT_SIDEBAR_RUNTIME_PREFERENCES },
    revision: undefined,
  }

  constructor(api: SidebarRuntimeSettingsApi = sidebarApi) {
    this.api = api
  }

  getSnapshot = (): SidebarRuntimeSettingsSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async start(): Promise<void> {
    this.publish({ ...this.snapshot, busy: true, error: null })
    try {
      this.publish(snapshotFromView(await this.api.settingsGet()))
    } catch {
      this.publish({ ...this.snapshot, busy: false, error: 'load' })
    }
  }

  update(patch: Partial<SidebarRuntimePreferences>): Promise<void> {
    const run = this.queue.then(async () => {
      const previous = this.snapshot
      this.publish({
        ...previous,
        busy: true,
        error: null,
        preferences: { ...previous.preferences, ...patch },
      })
      try {
        const view = await this.api.settingsUpdate(patch, previous.revision)
        this.publish(snapshotFromView(view))
      } catch {
        this.publish({ ...previous, busy: false, error: 'save' })
      }
    })
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  reset(): Promise<void> {
    return this.update({ ...DEFAULT_SIDEBAR_RUNTIME_PREFERENCES })
  }

  dispose(): void {
    this.listeners.clear()
  }

  private publish(snapshot: SidebarRuntimeSettingsSnapshot): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
}

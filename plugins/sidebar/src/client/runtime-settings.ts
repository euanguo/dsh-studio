import {
  sidebarApi,
  type SidebarSettingsView,
} from './sidebar-api.ts'

/**
 * Host-synced FEATURE preferences (the Side card namespace). These ride the
 * host settings service through /sidebar/api settings.* so they follow the
 * user across browsers and surfaces — the OTHER half of the sidebar's
 * deliberate two-store split; per-browser UI layouts stay in
 * sidebar-storage's localStorage (see the store-boundary note there).
 */

export interface SidebarRuntimePreferences {
  agentTerminalTools: boolean
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
  bottomPanelAutoTerminal: boolean
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
  autoOpenSubagent: true,
  autoOpenJobs: true,
  bottomPanelAutoTerminal: true,
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
  settingsGet(signal?: AbortSignal): Promise<SidebarSettingsView>
  settingsUpdate(
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<SidebarSettingsView>
}

function boundedNumberPreference(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

export function parseSidebarRuntimePreferences(
  value: unknown,
): SidebarRuntimePreferences {
  const record = value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  return {
    agentTerminalTools: typeof record.agentTerminalTools === 'boolean'
      ? record.agentTerminalTools
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.agentTerminalTools,
    autoOpenSubagent: typeof record.autoOpenSubagent === 'boolean'
      ? record.autoOpenSubagent
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.autoOpenSubagent,
    autoOpenJobs: typeof record.autoOpenJobs === 'boolean'
      ? record.autoOpenJobs
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.autoOpenJobs,
    bottomPanelAutoTerminal:
      typeof record.bottomPanelAutoTerminal === 'boolean'
        ? record.bottomPanelAutoTerminal
        : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.bottomPanelAutoTerminal,
    browserInterceptLinks: typeof record.browserInterceptLinks === 'boolean'
      ? record.browserInterceptLinks
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.browserInterceptLinks,
    browserInterceptHttp: typeof record.browserInterceptHttp === 'boolean'
      ? record.browserInterceptHttp
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.browserInterceptHttp,
    browserInterceptHttps: typeof record.browserInterceptHttps === 'boolean'
      ? record.browserInterceptHttps
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.browserInterceptHttps,
    htmlViewerNoSandbox: typeof record.htmlViewerNoSandbox === 'boolean'
      ? record.htmlViewerNoSandbox
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.htmlViewerNoSandbox,
    htmlViewerDefaultUnsafe: typeof record.htmlViewerDefaultUnsafe === 'boolean'
      ? record.htmlViewerDefaultUnsafe
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.htmlViewerDefaultUnsafe,
    terminalFontFamily: typeof record.terminalFontFamily === 'string'
      ? record.terminalFontFamily
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.terminalFontFamily,
    terminalFontSize: boundedNumberPreference(
      record,
      'terminalFontSize',
      DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.terminalFontSize,
      9,
      32,
    ),
    terminalShell: typeof record.terminalShell === 'string'
      ? record.terminalShell
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.terminalShell,
    terminalScrollbackRows: boundedNumberPreference(
      record,
      'terminalScrollbackRows',
      DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.terminalScrollbackRows,
      1_000,
      50_000,
    ),
    terminalReconnectGraceMs: boundedNumberPreference(
      record,
      'terminalReconnectGraceMs',
      DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.terminalReconnectGraceMs,
      0,
      120_000,
    ),
    terminalProcessKillGraceMs: boundedNumberPreference(
      record,
      'terminalProcessKillGraceMs',
      DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.terminalProcessKillGraceMs,
      250,
      10_000,
    ),
    terminalRetainedInactiveSessions: boundedNumberPreference(
      record,
      'terminalRetainedInactiveSessions',
      DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.terminalRetainedInactiveSessions,
      0,
      1_024,
    ),
    terminalMouseWheelMultiplier: boundedNumberPreference(
      record,
      'terminalMouseWheelMultiplier',
      DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.terminalMouseWheelMultiplier,
      0.25,
      4,
    ),
    terminalLigatures: typeof record.terminalLigatures === 'boolean'
      ? record.terminalLigatures
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.terminalLigatures,
    terminalGpuAcceleration: record.terminalGpuAcceleration === 'on'
      || record.terminalGpuAcceleration === 'off'
      || record.terminalGpuAcceleration === 'auto'
      ? record.terminalGpuAcceleration
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.terminalGpuAcceleration,
    interceptOpenPath: typeof record.interceptOpenPath === 'boolean'
      ? record.interceptOpenPath
      : DEFAULT_SIDEBAR_RUNTIME_PREFERENCES.interceptOpenPath,
  }
}

function snapshotFromView(
  view: SidebarSettingsView,
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

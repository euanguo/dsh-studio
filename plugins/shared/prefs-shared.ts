/**
 * Shared "Side card" preference vocabulary (types + constants), consumed by
 * BOTH halves: the host registers the schemastery schema over these values
 * (config.ts) and the client reads/writes them through the settings RPC
 * (client/prefs.ts, client/SideCardSection.tsx). Kept free of schemastery so
 * the browser bundle never pulls the schema runtime in.
 */

/** The user-settings namespace holding the side card preferences. */
export const SIDEBAR_PREFS_NS = 'dsh-better-sidebar'

/** User-facing side card preferences (new-conversation defaults). */
export interface SidebarPrefs {
  /**
   * Whether the sidebar auto-activates (opens the panel) and expands the
   * Subagent page when the current conversation spawns a new subagent.
   */
  autoOpenSubagent: boolean
  /**
   * Whether the sidebar auto-activates (opens the panel) and expands the
   * Jobs page when a NEW background job appears for the current
   * conversation (any new job id, not just the first one).
   */
  autoOpenJobs: boolean
  /**
   * Whether the model-facing agent terminal tools (terminal_create / list /
   * send / read / wait_for / resize / signal / close) are injected into the
   * model's toolset. Off by default: the feature stays dormant until the
   * user explicitly enables it in the side card settings.
   */
  agentTerminalTools: boolean
  /**
   * Whether model-facing WorkTree topology and lifecycle tools
   * (worktree_list / branches / status / create / remove) are injected.
   * Off by default: the feature stays dormant until the user explicitly
   * enables it in the side card settings.
   */
  agentWorktreeTools: boolean
  /**
   * Whether model-facing WorkTree delegation tools (worktree_delegate /
   * delegate_status / delegate_wait / delegate_stop / delegate_result) are
   * injected — the tools that start an independent Agent conversation in a
   * visible WorkTree and manage its lifecycle. Kept as a SEPARATE switch
   * from {@link agentWorktreeTools}: topology inspection and cross-project
   * conversation scheduling are distinct capabilities. Off by default.
   */
  agentWorktreeDelegationTools: boolean
  /**
   * Whether chat-side file opens (tool-row path links, the produced-files
   * row, prose file mentions — every path that funnels through the client
   * runtime's `ctx.workspaces.openPath`) open in the sidebar editor instead
   * of the Host OS's default application. On by default; the editor tab's
   * own enable switch gates it too (both must be on for the takeover).
   */
  interceptOpenPath: boolean
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
   * Whether clicking an http(s) EXTERNAL link in the GUI (chat messages,
   * tool rows, prose mentions) opens the sidebar browser instead of a new
   * browser tab. On by default; gated on the browser tab's own enable
   * switch (both must be on for the takeover). Ctrl/Cmd+click always
   * bypasses the takeover.
   */
  browserInterceptLinks: boolean
  /**
   * Explicit shell executable for the sidebar terminals (UI tabs + the
   * model-facing terminal tools). Empty follows the resolution chain
   * (deployment `shell` config → this setting → `DSH_SIDEBAR_SHELL` →
   * platform probe/login-shell chain → fallback); see
   * `plugins/capabilities/src/shell-resolver.ts`. Takes effect for NEW
   * terminals; already-running processes keep their shell.
   */
  terminalShell: string
  /** Custom xterm font family; empty follows the surface theme. */
  terminalFontFamily: string
  /** xterm font size in CSS pixels (9–32). */
  terminalFontSize: number
  /** Maximum terminal scrollback rows (1000–50000). */
  terminalScrollbackRows: number
  /** Detached shell reconnect grace in milliseconds (0–120000). */
  terminalReconnectGraceMs: number
  /** SIGTERM→SIGKILL escalation delay in milliseconds (250–10000). */
  terminalProcessKillGraceMs: number
  /** Maximum retained inactive terminal sessions (0–1024). */
  terminalRetainedInactiveSessions: number
  /** Mouse wheel multiplier applied to terminal wheel events (0.25–4). */
  terminalMouseWheelMultiplier: number
  /** Enable optional ligature rendering when the addon is available. */
  terminalLigatures: boolean
  /** GPU renderer policy: automatic, forced on, or forced off. */
  terminalGpuAcceleration: 'auto' | 'on' | 'off'
  /**
   * Per-tab enable switches, keyed by tab descriptor id (`'explorer'`,
   * `'my-plugin:db'`). An ABSENT key means enabled — only an explicit
   * `false` disables a tab type (hidden from the + menu, `openTab` refuses,
   * and derived flows like subagent auto-open / agent-terminal tabs stop).
   * Already-open tabs of a disabled type keep rendering (closing one
   * prevents reopening), matching the "existing conversations keep their
   * own layouts" rule.
   */
  tabsEnabled: Record<string, boolean>
  /**
   * Per-viewer enable switches, keyed by file viewer descriptor id
   * (`'image'`, `'my-plugin:csv'`). An ABSENT key means enabled; a disabled
   * viewer is skipped by `matchFileViewer` so files fall through to the
   * next matching viewer (or the download button when none match).
   */
  viewersEnabled: Record<string, boolean>
}

/** Fallback prefs used whenever the settings document is unreachable or malformed. */
export const SIDEBAR_PREFS_DEFAULTS: SidebarPrefs = {
  autoOpenSubagent: true,
  autoOpenJobs: true,
  agentTerminalTools: false,
  agentWorktreeTools: false,
  agentWorktreeDelegationTools: false,
  interceptOpenPath: true,
  htmlViewerNoSandbox: false,
  htmlViewerDefaultUnsafe: false,
  browserInterceptLinks: true,
  terminalShell: '',
  terminalFontFamily: '',
  terminalFontSize: 13,
  terminalScrollbackRows: 5_000,
  terminalReconnectGraceMs: 30_000,
  terminalProcessKillGraceMs: 1_500,
  terminalRetainedInactiveSessions: 128,
  terminalMouseWheelMultiplier: 1,
  terminalLigatures: false,
  terminalGpuAcceleration: 'auto',
  tabsEnabled: {},
  viewersEnabled: {},
}

/**
 * Serializable configuration and defaults for the capabilities host half. Loader
 * schema validation normally fills defaults; {@link resolveCapabilitiesConfig}
 * applies the same defaults for direct callers that bypass the Loader.
 * @module dsh-studio-capabilities/config
 */

import z from 'schemastery'
import {
  SIDEBAR_PREFS_DEFAULTS,
  SIDEBAR_PREFS_NS,
  WIDTH_PERCENT_DEFAULT,
  WIDTH_PERCENT_MAX,
  WIDTH_PERCENT_MIN,
  type SidebarPrefs,
} from '@dsh-studio/shared/prefs-shared'
import { DESKTOP_TERMINALS_PER_SESSION_DEFAULT } from '@dsh-studio/shared/terminal-scrollback-policy'

export {
  SIDEBAR_PREFS_DEFAULTS,
  SIDEBAR_PREFS_NS,
  WIDTH_PERCENT_DEFAULT,
  WIDTH_PERCENT_MAX,
  WIDTH_PERCENT_MIN,
  type SidebarPrefs,
} from '@dsh-studio/shared/prefs-shared'

/** Tunable sidebar host limits (every field optional; defaults fill in). */
export interface CapabilitiesConfig {
  /** Read cap of one text file (bytes); larger files return truncated. */
  readLimit?: number
  /** Media route cap (bytes); larger binaries are refused. */
  mediaLimit?: number
  /** Explorer row bound of one level. */
  listLimit?: number
  /** Terminals per session. */
  terminalsPerSession?: number
  /** How long a disconnected terminal process survives awaiting a reconnect. */
  reconnectGraceMs?: number
  /** Explicit shell executable for the sidebar terminals (deployment
   *  override). Wins over the settings `terminalShell` and every automatic
   *  source; empty/unset follows the resolution chain (shell-resolver.ts). */
  shell?: string
}

/** Schemastery schema for the plugin configuration. */
export const Config: z<CapabilitiesConfig> = z.object({
  readLimit: z.number().step(1).min(1).default(1024 * 1024),
  mediaLimit: z.number().step(1).min(1).default(20 * 1024 * 1024),
  listLimit: z.number().step(1).min(1).default(1000),
  terminalsPerSession: z.number().step(1).min(1).default(DESKTOP_TERMINALS_PER_SESSION_DEFAULT),
  reconnectGraceMs: z.number().step(1).min(0).default(30_000),
  // schemastery object fields are optional by default; an absent `shell`
  // stays undefined and the resolution chain falls through.
  shell: z.string(),
})

/** Fully defaulted sidebar host settings. */
export interface ResolvedCapabilitiesConfig {
  readLimit: number
  mediaLimit: number
  listLimit: number
  terminalsPerSession: number
  reconnectGraceMs: number
  /** The explicit shell override, or undefined when unset. */
  shell: string | undefined
}

/**
 * Apply direct-call defaults after Loader schema validation has normally run.
 *
 * @param config - Deployment-provided sidebar host settings.
 * @returns Complete settings consumed by the host half.
 */
export function resolveCapabilitiesConfig(config: CapabilitiesConfig | undefined): ResolvedCapabilitiesConfig {
  const trimmedShell = config?.shell?.trim() ?? ''
  return {
    readLimit: config?.readLimit ?? 1024 * 1024,
    mediaLimit: config?.mediaLimit ?? 20 * 1024 * 1024,
    listLimit: config?.listLimit ?? 1000,
    terminalsPerSession: config?.terminalsPerSession ?? DESKTOP_TERMINALS_PER_SESSION_DEFAULT,
    reconnectGraceMs: config?.reconnectGraceMs ?? 30_000,
    shell: trimmedShell === '' ? undefined : trimmedShell,
  }
}

// ── User-facing "Side card" preferences ─────────────────────────────────────

/** Schemastery schema for the user-facing preferences (validated by the settings service). */
export const PrefsSchema: z<SidebarPrefs> = z.object({
  openByDefault: z.boolean().default(true),
  defaultWidthPercent: z.number().step(1).min(WIDTH_PERCENT_MIN).max(WIDTH_PERCENT_MAX).default(WIDTH_PERCENT_DEFAULT),
  autoOpenSubagent: z.boolean().default(true),
  autoOpenJobs: z.boolean().default(true),
  agentTerminalTools: z.boolean().default(false),
  agentWorktreeTools: z.boolean().default(false),
  bottomPanelAutoTerminal: z.boolean().default(true),
  interceptOpenPath: z.boolean().default(true),
  htmlViewerNoSandbox: z.boolean().default(false),
  htmlViewerDefaultUnsafe: z.boolean().default(false),
  browserNoSandbox: z.boolean().default(false),
  browserInterceptLinks: z.boolean().default(true),
  terminalShell: z.string().default(''),
  terminalFontFamily: z.string().default(''),
  terminalFontSize: z.number().step(1).min(9).max(32).default(13),
  terminalScrollbackRows: z.number().step(1).min(1000).max(50000).default(5000),
  terminalReconnectGraceMs: z.number().step(1).min(0).max(120_000).default(30_000),
  terminalProcessKillGraceMs: z.number().step(1).min(250).max(10_000).default(1_500),
  terminalRetainedInactiveSessions: z.number().step(1).min(0).max(1_024).default(128),
  terminalMouseWheelMultiplier: z.number().step(0.25).min(0.25).max(4).default(1),
  terminalLigatures: z.boolean().default(false),
  terminalGpuAcceleration: z.union([
    z.const('auto'),
    z.const('on'),
    z.const('off'),
  ]).default('auto'),
  // Per-feature enable switches are OPEN maps (any tab/viewer id, built-in or
  // external): an absent key means enabled, so old documents resolve to {}
  // (everything on) with no migration. Non-boolean values fail validation.
  tabsEnabled: z.dict(z.boolean()).default({}),
  viewersEnabled: z.dict(z.boolean()).default({}),
})

// ── Left-rail view slice (dsh-studio-left-rail namespace) ───────────────────────
// Registered through the same settings seam as the sidebar prefs, so the
// schema gives the namespace defaults/validation and the namespace owns its
// section in the settings document (see docs/persistence-architecture.md).

/** Schemastery schema for the durable left-rail view slice. */
export const LeftRailSettingsSchema = z.object({
  version: z.number().step(1).min(1).required(false),
  activeTab: z.string(),
  projectGroup: z.dict(z.string()).default({}),
  groupIds: z.array(z.string()),
  groupLabels: z.dict(z.string()).default({}),
  projectAlias: z.dict(z.string()).default({}),
  worktreeAlias: z.dict(z.string()).default({}),
  projectIconOverrides: z.dict(z.union([
    z.object({
      kind: z.const('builtin'),
      // Coarse structural gate; the exact allowlist lives in the shared
      // sanitizeProjectIconPreference consumed on the client.
      name: z.string(),
    }),
    z.object({
      kind: z.const('upload'),
      mime: z.const('image/png'),
      data: z.string(),
    }),
  ])).default({}),
  // New-worktree store location (see shared/worktree-preferences.ts): an
  // absolute user override (empty/unset = the data-root default) and the
  // repo-name nesting switch. Coarse structural gates; the exact
  // absolute-path rule lives in the shared sanitizer.
  worktreeDir: z.string(),
  nestWorktrees: z.boolean().default(true),
})

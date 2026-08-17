/**
 * Serializable configuration and defaults for the sidebar host half. Loader
 * schema validation normally fills defaults; {@link resolveSidebarConfig}
 * applies the same defaults for direct callers that bypass the Loader.
 * @module dsh-better-sidebar/config
 */

import z from 'schemastery'
import {
  SIDEBAR_PREFS_DEFAULTS,
  SIDEBAR_PREFS_NS,
  WIDTH_PERCENT_DEFAULT,
  WIDTH_PERCENT_MAX,
  WIDTH_PERCENT_MIN,
  type SidebarPrefs,
} from '@oh-dsh/shared/prefs-shared'

export {
  SIDEBAR_PREFS_DEFAULTS,
  SIDEBAR_PREFS_NS,
  WIDTH_PERCENT_DEFAULT,
  WIDTH_PERCENT_MAX,
  WIDTH_PERCENT_MIN,
  type SidebarPrefs,
} from '@oh-dsh/shared/prefs-shared'

/** Tunable sidebar host limits (every field optional; defaults fill in). */
export interface SidebarConfig {
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
export const Config: z<SidebarConfig> = z.object({
  readLimit: z.number().step(1).min(1).default(1024 * 1024),
  mediaLimit: z.number().step(1).min(1).default(20 * 1024 * 1024),
  listLimit: z.number().step(1).min(1).default(1000),
  terminalsPerSession: z.number().step(1).min(1).default(3),
  reconnectGraceMs: z.number().step(1).min(0).default(30_000),
  // schemastery object fields are optional by default; an absent `shell`
  // stays undefined and the resolution chain falls through.
  shell: z.string(),
})

/** Fully defaulted sidebar host settings. */
export interface ResolvedSidebarConfig {
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
export function resolveSidebarConfig(config: SidebarConfig | undefined): ResolvedSidebarConfig {
  const trimmedShell = config?.shell?.trim() ?? ''
  return {
    readLimit: config?.readLimit ?? 1024 * 1024,
    mediaLimit: config?.mediaLimit ?? 20 * 1024 * 1024,
    listLimit: config?.listLimit ?? 1000,
    terminalsPerSession: config?.terminalsPerSession ?? 3,
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
  bottomPanelAutoTerminal: z.boolean().default(true),
  interceptOpenPath: z.boolean().default(true),
  htmlViewerNoSandbox: z.boolean().default(false),
  htmlViewerDefaultUnsafe: z.boolean().default(false),
  browserNoSandbox: z.boolean().default(false),
  browserInterceptLinks: z.boolean().default(true),
  terminalShell: z.string().default(''),
  // Per-feature enable switches are OPEN maps (any tab/viewer id, built-in or
  // external): an absent key means enabled, so old documents resolve to {}
  // (everything on) with no migration. Non-boolean values fail validation.
  tabsEnabled: z.dict(z.boolean()).default({}),
  viewersEnabled: z.dict(z.boolean()).default({}),
})

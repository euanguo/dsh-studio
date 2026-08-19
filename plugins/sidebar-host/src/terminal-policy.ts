import {
  DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT,
  terminalHistoryLimitsForRows,
} from '@dsh-studio/shared/terminal-scrollback-policy'

export interface TerminalRuntimePolicy {
  scrollbackRows: number
  reconnectGraceMs: number
  processKillGraceMs: number
  retainedInactiveSessions: number
}

export const DEFAULT_TERMINAL_RUNTIME_POLICY: Readonly<TerminalRuntimePolicy> = Object.freeze({
  scrollbackRows: DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT,
  reconnectGraceMs: 30_000,
  processKillGraceMs: 1_500,
  retainedInactiveSessions: 128,
})

export function normalizeTerminalRuntimePolicy(
  value: Partial<TerminalRuntimePolicy> | undefined,
): TerminalRuntimePolicy {
  const scrollbackRows = terminalHistoryLimitsForRows(value?.scrollbackRows).maxLines
  return {
    scrollbackRows,
    reconnectGraceMs: bounded(value?.reconnectGraceMs, 30_000, 0, 120_000),
    processKillGraceMs: bounded(value?.processKillGraceMs, 1_500, 250, 10_000),
    retainedInactiveSessions: bounded(value?.retainedInactiveSessions, 128, 0, 1_024),
  }
}

function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

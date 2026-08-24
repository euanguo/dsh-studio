/**
 * Terminal scrollback policy (ported from orca's
 * `src/shared/terminal-scrollback-policy.ts`).
 *
 * Provides pure desktop scrollback row normalization, legacy decimal-MB
 * bucket mapping, and output backlog byte caps scaled with scrollback depth.
 */

export const DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT = 5_000
export const DESKTOP_TERMINALS_PER_SESSION_DEFAULT = 64
export const DESKTOP_TERMINAL_SCROLLBACK_ROWS_MIN = 1_000
export const DESKTOP_TERMINAL_SCROLLBACK_ROWS_MAX = 50_000
export const DESKTOP_TERMINAL_HISTORY_BYTES_MIN = 1 * 1024 * 1024
export const DESKTOP_TERMINAL_HISTORY_BYTES_MAX = 8 * 1024 * 1024
export const DESKTOP_TERMINAL_SCROLLBACK_ROW_CHARS = 120
export const DESKTOP_TERMINAL_SCROLLBACK_ROW_PRESETS = [5_000, 10_000, 25_000, 50_000] as const

export const LEGACY_TERMINAL_SCROLLBACK_BYTES_1_MB = 1_000_000
export const LEGACY_TERMINAL_SCROLLBACK_BYTES_10_MB = 10_000_000
export const LEGACY_TERMINAL_SCROLLBACK_BYTES_25_MB = 25_000_000
export const LEGACY_TERMINAL_SCROLLBACK_BYTES_50_MB = 50_000_000
export const LEGACY_TERMINAL_SCROLLBACK_BYTES_100_MB = 100_000_000

export const LEGACY_TERMINAL_SCROLLBACK_BUCKET_5K_MAX_BYTES = 17_500_000
export const LEGACY_TERMINAL_SCROLLBACK_BUCKET_10K_MAX_BYTES = 37_500_000
export const LEGACY_TERMINAL_SCROLLBACK_BUCKET_25K_MAX_BYTES = 75_000_000

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clampRows(value: number, min: number): number {
  return Math.min(DESKTOP_TERMINAL_SCROLLBACK_ROWS_MAX, Math.max(min, Math.floor(value)))
}

export function normalizeDesktopTerminalScrollbackRows(value: unknown): number {
  if (!isFiniteNumber(value)) {
    return DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT
  }
  return clampRows(value, DESKTOP_TERMINAL_SCROLLBACK_ROWS_MIN)
}

/**
 * Why the backlog cap scales with scrollback: pending-output caps exist to
 * bound memory while a starved display catches up, but a user who raised
 * scrollback to 50k rows can retain more history than the flat 2 MB floor —
 * dropping at the floor would discard lines their scrollback would have kept.
 * 120 chars/row ≈ 80-col text plus escape-sequence overhead; the cap is a
 * memory bound, not an exact retention guarantee.
 */
export const TERMINAL_OUTPUT_BACKLOG_MIN_CAP_CHARS = 2 * 1024 * 1024
const OUTPUT_BACKLOG_CHARS_PER_SCROLLBACK_ROW = DESKTOP_TERMINAL_SCROLLBACK_ROW_CHARS

export interface TerminalHistoryLimits {
  maxLines: number
  maxBytes: number
}

/** Host history cap derived from the user-visible scrollback setting. */
export function terminalHistoryLimitsForRows(rows: unknown): TerminalHistoryLimits {
  const normalized = normalizeDesktopTerminalScrollbackRows(rows)
  return {
    maxLines: normalized,
    maxBytes: Math.min(
      DESKTOP_TERMINAL_HISTORY_BYTES_MAX,
      Math.max(DESKTOP_TERMINAL_HISTORY_BYTES_MIN, normalized * DESKTOP_TERMINAL_SCROLLBACK_ROW_CHARS),
    ),
  }
}

export function terminalOutputBacklogCapChars(scrollbackRows: unknown): number {
  const rows = normalizeDesktopTerminalScrollbackRows(scrollbackRows)
  return Math.max(
    TERMINAL_OUTPUT_BACKLOG_MIN_CAP_CHARS,
    rows * OUTPUT_BACKLOG_CHARS_PER_SCROLLBACK_ROW,
  )
}

export function normalizeDesktopTerminalSnapshotRows(value: unknown): number | undefined {
  if (!isFiniteNumber(value)) {
    return undefined
  }
  return clampRows(value, 0)
}

export function legacyTerminalScrollbackBytesToRows(bytes: unknown): number {
  if (!isFiniteNumber(bytes) || bytes <= 0) {
    return DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT
  }
  if (bytes <= LEGACY_TERMINAL_SCROLLBACK_BYTES_1_MB) {
    return DESKTOP_TERMINAL_SCROLLBACK_ROWS_MIN
  }
  if (bytes < LEGACY_TERMINAL_SCROLLBACK_BUCKET_5K_MAX_BYTES) {
    return DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT
  }
  if (bytes < LEGACY_TERMINAL_SCROLLBACK_BUCKET_10K_MAX_BYTES) {
    return 10_000
  }
  if (bytes < LEGACY_TERMINAL_SCROLLBACK_BUCKET_25K_MAX_BYTES) {
    return 25_000
  }
  return DESKTOP_TERMINAL_SCROLLBACK_ROWS_MAX
}
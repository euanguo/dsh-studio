/** Public xterm-like cursor geometry used to place an IME composition anchor. */
export interface TerminalImeCursor {
  row: number
  col: number
}

export interface TerminalImeAnchorOptions {
  /** Prompt column, when the cursor row contains a known prompt marker. */
  promptColumn?: number
  /** Visible row containing the prompt marker, when known. */
  promptVisibleRow?: number
}

export interface TerminalImeAnchorInput {
  cursor: TerminalImeCursor
  rows: number
  cols: number
  options?: TerminalImeAnchorOptions
}

export interface TerminalImeAnchor {
  row: number
  col: number
}

function finiteInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Computes a safe viewport-relative IME anchor from public terminal geometry.
 * Invalid dimensions use a one-cell viewport; invalid cursor values fall back
 * to its origin. A prompt marker is applied only when its visible row is valid.
 */
export function computeTerminalImeAnchor(input: TerminalImeAnchorInput): TerminalImeAnchor {
  const rows = Math.max(1, finiteInteger(input.rows, 1))
  const cols = Math.max(1, finiteInteger(input.cols, 1))
  const cursorRow = finiteInteger(input.cursor?.row, 0)
  const cursorCol = finiteInteger(input.cursor?.col, 0)
  const row = clamp(cursorRow, 0, rows - 1)
  let col = clamp(cursorCol, 0, cols - 1)

  const promptRow = input.options?.promptVisibleRow
  const promptColumn = input.options?.promptColumn
  if (
    typeof promptRow === 'number' && Number.isFinite(promptRow) &&
    typeof promptColumn === 'number' && Number.isFinite(promptColumn) &&
    Math.floor(promptRow) === row
  ) {
    col = clamp(Math.floor(promptColumn), 0, cols - 1)
  }

  return { row, col }
}

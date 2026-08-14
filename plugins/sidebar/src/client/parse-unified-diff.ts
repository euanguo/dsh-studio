/**
 * Unified-diff text parser (pure, no React). Consumes the raw `git diff`
 * output and produces a line-level model for the diff view: hunks, line
 * numbers (old/new), and add/del/context classification.
 */

export type DiffLineType = 'context' | 'addition' | 'deletion'

export interface DiffLine {
  type: DiffLineType
  /** Line number in the old file (null for pure additions). */
  oldLine: number | null
  /** Line number in the new file (null for pure deletions). */
  newLine: number | null
  /** Raw content without the leading +/−/space marker. */
  content: string
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface ParsedDiff {
  /** `a/…` vs `b/…` paths from the `diff --git` header ('' when absent). */
  oldPath: string
  newPath: string
  hunks: DiffHunk[]
}

/** Parse one unified diff document; null when the text is not a diff. */
export function parseUnifiedDiff(text: string): ParsedDiff | null {
  const lines = text.split('\n')
  if (lines.length === 0) return null

  let oldPath = ''
  let newPath = ''
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0
  let sawHunk = false

  for (const raw of lines) {
    if (raw.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.*?) b\/(.*)$/.exec(raw)
      if (match !== null) {
        oldPath = match[1] ?? ''
        newPath = match[2] ?? ''
      }
      continue
    }
    if (raw.startsWith('@@')) {
      const header = raw.slice(0, raw.indexOf('@@', 2) + 2)
      current = { header, lines: [] }
      hunks.push(current)
      sawHunk = true
      const ranges = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw)
      oldLine = ranges === null ? 0 : Number(ranges[1] ?? '0')
      newLine = ranges === null ? 0 : Number(ranges[3] ?? '0')
      continue
    }
    if (current === null) continue
    if (raw === '\\' || raw.startsWith('\\ No newline')) {
      // Trailing marker lines are ignored; they do not consume numbers.
      continue
    }
    const marker = raw.charAt(0)
    if (marker === ' ') {
      current.lines.push({
        type: 'context',
        oldLine,
        newLine,
        content: raw.slice(1),
      })
      oldLine += 1
      newLine += 1
    } else if (marker === '-') {
      current.lines.push({
        type: 'deletion',
        oldLine,
        newLine: null,
        content: raw.slice(1),
      })
      oldLine += 1
    } else if (marker === '+') {
      current.lines.push({
        type: 'addition',
        oldLine: null,
        newLine,
        content: raw.slice(1),
      })
      newLine += 1
    } else {
      // Header lines (--- / +++ / index / …) are skipped.
      continue
    }
  }

  return sawHunk ? { oldPath, newPath, hunks } : null
}

/** Whether the document is a plain "no text diff" response. */
export function isNoTextDiff(text: string): boolean {
  const trimmed = text.trim()
  return trimmed === '' || /^binary files .* differ/i.test(trimmed)
}

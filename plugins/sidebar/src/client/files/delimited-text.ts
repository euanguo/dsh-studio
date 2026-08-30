/**
 * RFC 4180 CSV/TSV parsing for lightweight file previews, delegating to
 * `papaparse` (the canonical browser CSV parser: quotes, escaped quotes,
 * CRLF, lone CR and malformed-input tolerance all handled upstream).
 *
 * `detectDelimiter` stays hand-written on purpose: extension (.tsv) wins and
 * the fallback is an explicit tab-vs-comma count — an UX heuristic, not
 * parsing logic.
 */
import Papa from 'papaparse'

export const MAX_CSV_ROWS = 100_000

export function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows = Papa.parse<string[]>(text, { delimiter }).data.slice(0, MAX_CSV_ROWS)
  // papaparse emits one trailing [''] for a final line break; the preview
  // treats a trailing newline as a row terminator (no extra empty row), so
  // drop that single terminator artifact.
  if (
    rows.length > 0
    && /[\r\n]$/.test(text)
    && rows[rows.length - 1]!.length === 1
    && rows[rows.length - 1]![0] === ''
  ) {
    rows.pop()
  }
  return rows
}

/** Pick the delimiter that yields the most columns for .csv/.tsv-ish text. */
export function detectDelimiter(path: string, text: string): ',' | '\t' {
  if (path.toLowerCase().endsWith('.tsv')) return '\t'
  const sample = text.slice(0, 64_000)
  const tabs = sample.split('\t').length - 1
  const commas = sample.split(',').length - 1
  return tabs > commas ? '\t' : ','
}
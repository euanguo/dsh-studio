/** Minimal RFC-ish CSV/TSV split for lightweight file previews. */
export const MAX_CSV_ROWS = 2_000

export function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === delimiter) {
      row.push(cell)
      cell = ''
      continue
    }
    if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      if (rows.length >= MAX_CSV_ROWS) return rows
      continue
    }
    if (ch === '\r') continue
    cell += ch
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
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

/**
 * Pure ipynb JSON parsing (no React).
 *
 * Kept hand-written on purpose (ADR): the notebook preview only needs a
 * structural `cells[].cell_type/source` validation; a full nbformat schema
 * (ajv + nbformat JSON schema) would change error tolerance and add weight
 * for zero preview benefit.
 */
export interface IpynbCell {
  cell_type: 'code' | 'markdown' | 'raw' | string
  source: string[] | string
}

export function parseIpynb(text: string): { cells: IpynbCell[]; error: string | null } {
  try {
    const parsed = JSON.parse(text) as { cells?: unknown }
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.cells)) {
      return { cells: [], error: 'Not a valid ipynb file.' }
    }
    return {
      cells: parsed.cells.filter(
        (cell): cell is IpynbCell =>
          typeof cell === 'object' && cell !== null && typeof (cell as { cell_type?: unknown }).cell_type === 'string',
      ),
      error: null,
    }
  } catch (error) {
    return { cells: [], error: error instanceof Error ? error.message : String(error) }
  }
}

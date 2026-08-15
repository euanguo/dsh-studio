/** Pure ipynb JSON parsing (no React). */
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

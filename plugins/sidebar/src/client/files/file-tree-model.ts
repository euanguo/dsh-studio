/**
 * File-browser row model (pure functions, no React).
 *
 * Single tree mode over one lazy directory cache: directory rows toggle
 * expansion (children load lazily on first expansion), file rows are
 * selected/previewed on click. The cache (`entriesByDir`) is owned by the
 * explorer runtime — the view never fetches.
 */
import type { WorkspaceFileEntry, WorkspaceFileKind } from '../../protocol.ts'

export interface FileRow {
  kind: WorkspaceFileKind
  key: string
  name: string
  path: string
  size: number | null
  depth: number
  /** Directory rows know whether their children are loaded/expanded. */
  expanded: boolean
  selected: boolean
}

export interface FileRowsInput {
  /** The tree root (absolute path; normally the workspace cwd). */
  currentPath: string
  /** Absolute directory path → its entries (lazy cache from the runtime). */
  entriesByDir: ReadonlyMap<string, readonly WorkspaceFileEntry[]>
  expandedDirs: ReadonlySet<string>
  selectedPath: string | null
}

function sortEntries(entries: readonly WorkspaceFileEntry[]): WorkspaceFileEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1
    }
    return left.name.localeCompare(right.name, undefined, { numeric: true })
  })
}

/** Build the visible row stream for one snapshot (recursive tree expansion). */
export function buildFileRows(input: FileRowsInput): FileRow[] {
  const rows: FileRow[] = []

  const emit = (dirPath: string, depth: number): void => {
    const entries = input.entriesByDir.get(dirPath)
    if (entries === undefined) return
    for (const entry of sortEntries(entries)) {
      const expanded = entry.kind === 'directory' && input.expandedDirs.has(entry.path)
      rows.push({
        kind: entry.kind,
        key: entry.path,
        name: entry.name,
        path: entry.path,
        size: entry.size,
        depth,
        expanded,
        selected: input.selectedPath === entry.path,
      })
      if (expanded) emit(entry.path, depth + 1)
    }
  }

  emit(input.currentPath, 0)
  return rows
}

/** The first directory row's path under a mode (for empty-state hints). */
export function hasLoadedChildren(
  entriesByDir: ReadonlyMap<string, readonly WorkspaceFileEntry[]>,
  path: string,
): boolean {
  return entriesByDir.has(path)
}

/**
 * File-browser row model (pure functions, no React).
 *
 * Three display modes over one lazy directory cache:
 * - flat:   the current directory's entries, single level (browse by
 *           entering directories);
 * - nested: the current directory, with each directory row immediately
 *           followed by its loaded children (indented two levels);
 * - tree:   recursive expansion of loaded directories with arbitrary depth
 *           (directory rows toggle expansion; children load lazily).
 *
 * The cache (`entriesByDir`) is owned by the view: directories are fetched
 * on first expansion / entry and stored by absolute path.
 */
import type { WorkspaceFileEntry, WorkspaceFileKind } from '../protocol.ts'

export type FileBrowseMode = 'flat' | 'nested' | 'tree'

export const FILE_BROWSE_MODES: readonly FileBrowseMode[] = ['flat', 'nested', 'tree']

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
  mode: FileBrowseMode
  currentPath: string
  /** Absolute directory path → its entries (lazy cache). */
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

/** Build the visible row stream for one directory snapshot + mode. */
export function buildFileRows(input: FileRowsInput): FileRow[] {
  const rows: FileRow[] = []

  const emit = (dirPath: string, depth: number, recursive: boolean): void => {
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
      if (recursive && expanded) emit(entry.path, depth + 1, true)
    }
  }

  if (input.mode === 'flat') {
    emit(input.currentPath, 0, false)
  } else if (input.mode === 'nested') {
    // Directory rows are immediately followed by their loaded children.
    const entries = input.entriesByDir.get(input.currentPath)
    if (entries !== undefined) {
      for (const entry of sortEntries(entries)) {
        rows.push({
          kind: entry.kind,
          key: entry.path,
          name: entry.name,
          path: entry.path,
          size: entry.size,
          depth: 0,
          expanded: false,
          selected: input.selectedPath === entry.path,
        })
        if (entry.kind === 'directory') emit(entry.path, 1, false)
      }
    }
  } else {
    emit(input.currentPath, 0, true)
  }
  return rows
}

/** The first directory row's path under a mode (for empty-state hints). */
export function hasLoadedChildren(
  entriesByDir: ReadonlyMap<string, readonly WorkspaceFileEntry[]>,
  path: string,
): boolean {
  return entriesByDir.has(path)
}

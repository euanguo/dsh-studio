import type { DiffPathTreeRow } from './path-tree-nav.tsx'

/**
 * Builds the flattened rows for a diff path tree in depth-first order:
 * directories before files at every level (explorer convention), a
 * directory's direct children emitted right after the directory row.
 * `collapsedDirs` holds plain directory paths (no `dir:` prefix).
 */
export function buildDiffTreeRows(
  files: ReadonlyArray<{ path: string }>,
  selectedPath: string | null,
  collapsedDirs: ReadonlySet<string>,
): DiffPathTreeRow[] {
  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path))

  // Directory paths with their descendant file counts.
  const dirCounts = new Map<string, number>()
  for (const file of ordered) {
    const segments = file.path.split('/')
    for (let index = 0; index < segments.length - 1; index += 1) {
      const dirPath = segments.slice(0, index + 1).join('/')
      dirCounts.set(dirPath, (dirCounts.get(dirPath) ?? 0) + 1)
    }
  }
  const dirPaths = [...dirCounts.keys()].sort((a, b) => a.localeCompare(b))

  // Files grouped by their direct parent directory (null for top level).
  const filesByParent = new Map<string | null, Array<{ path: string; name: string }>>()
  for (const file of ordered) {
    const segments = file.path.split('/')
    const parent = segments.length > 1 ? segments.slice(0, -1).join('/') : null
    const list = filesByParent.get(parent) ?? []
    list.push({ path: file.path, name: segments.at(-1) ?? file.path })
    filesByParent.set(parent, list)
  }

  const parentOf = (dirPath: string): string | null =>
    dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : null

  const rows: DiffPathTreeRow[] = []

  function emitFile(path: string, name: string, depth: number) {
    rows.push({
      key: `file:${path}`,
      kind: 'file',
      path,
      name,
      depth,
      selected: path === selectedPath,
    })
  }

  function emitLevel(dirPath: string | null, depth: number) {
    for (const sub of dirPaths.filter(candidate => parentOf(candidate) === dirPath)) {
      rows.push({
        key: `dir:${sub}`,
        kind: 'directory',
        path: sub,
        name: sub.split('/').at(-1) ?? sub,
        depth,
        fileCount: dirCounts.get(sub) ?? 0,
        collapsed: collapsedDirs.has(sub),
      })
      if (!collapsedDirs.has(sub)) emitLevel(sub, depth + 1)
    }
    for (const file of filesByParent.get(dirPath) ?? []) {
      emitFile(file.path, file.name, depth)
    }
  }

  emitLevel(null, 0)
  return rows
}

import type { DiffPathTreeRow } from './path-tree-nav.tsx'

export function buildDiffTreeRows(
  files: ReadonlyArray<{ path: string }>,
  selectedPath: string | null,
  collapsedDirs: ReadonlySet<string>,
): DiffPathTreeRow[] {
  const dirs = new Map<string, { path: string; name: string; depth: number; count: number }>()
  const fileRows: DiffPathTreeRow[] = []
  const ordered = [...files].sort((a, b) => a.path.localeCompare(b.path))
  for (const file of ordered) {
    const segments = file.path.split('/')
    for (let index = 0; index < segments.length - 1; index += 1) {
      const dirPath = segments.slice(0, index + 1).join('/')
      const existing = dirs.get(dirPath)
      if (existing === undefined) {
        dirs.set(dirPath, { path: dirPath, name: segments[index] ?? dirPath, depth: index, count: 1 })
      } else {
        existing.count += 1
      }
    }
    fileRows.push({
      key: `file:${file.path}`,
      kind: 'file',
      path: file.path,
      name: segments.at(-1) ?? file.path,
      depth: segments.length - 1,
      selected: file.path === selectedPath,
    })
  }

  const rows: DiffPathTreeRow[] = []
  const sortedDirs = [...dirs.values()].sort((a, b) => a.path.localeCompare(b.path))
  for (const dir of sortedDirs) {
    const parent = dir.path.includes('/') ? dir.path.slice(0, dir.path.lastIndexOf('/')) : null
    if (parent !== null && collapsedDirs.has(parent)) continue
    rows.push({
      key: `dir:${dir.path}`,
      kind: 'directory',
      path: dir.path,
      name: dir.name,
      depth: dir.depth,
      fileCount: dir.count,
      collapsed: collapsedDirs.has(dir.path),
    })
  }
  for (const file of fileRows) {
    const parent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : null
    if (parent !== null && collapsedDirs.has(parent)) continue
    rows.push(file)
  }
  return rows
}

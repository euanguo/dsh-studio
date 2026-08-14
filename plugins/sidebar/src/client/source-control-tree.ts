/**
 * Source-control tree model (pure functions, no React).
 *
 * Adapted from the reference project's `source-control-tree.ts` pattern:
 * paths are split on `/`, inserted into a directory/file tree with `depth`
 * and `fileCount`, single-child directory chains are compacted, and a
 * collapsed-directory key set flattens the tree into a stable row stream.
 */
import type { WorkspaceChange } from '../protocol.ts'

export type SourceControlSectionId =
  | 'staged'
  | 'unstaged'

/** Two-area layout: staged on top, unstaged below (includes conflicts). */
export const SECTION_ORDER: readonly SourceControlSectionId[] = [
  'staged',
  'unstaged',
]

export function sectionOfChange(change: WorkspaceChange): SourceControlSectionId {
  return change.staged ? 'staged' : 'unstaged'
}

export function canStageChange(change: WorkspaceChange): boolean {
  return !change.staged && change.status !== 'conflicted'
}

export function canUnstageChange(change: WorkspaceChange): boolean {
  return change.staged
}

export function canDiscardChange(change: WorkspaceChange): boolean {
  return !change.staged && change.status !== 'conflicted'
}

export type SourceControlFileNode = {
  kind: 'file'
  key: string
  name: string
  path: string
  depth: number
  change: WorkspaceChange
}

export type SourceControlDirectoryNode = {
  kind: 'directory'
  key: string
  name: string
  path: string
  depth: number
  fileCount: number
  children: SourceControlTreeNode[]
}

export type SourceControlTreeNode =
  | SourceControlFileNode
  | SourceControlDirectoryNode

type MutableDirectory = {
  kind: 'directory'
  key: string
  name: string
  path: string
  depth: number
  fileCount: number
  children: Array<MutableDirectory | SourceControlFileNode>
  directories: Map<string, MutableDirectory>
}

function createDirectory(
  path: string,
  name: string,
  depth: number,
): MutableDirectory {
  return {
    kind: 'directory',
    key: `directory:${path}`,
    name,
    path,
    depth,
    fileCount: 0,
    children: [],
    directories: new Map(),
  }
}

function normalizeRelativePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
}

function splitPathSegments(path: string): string[] {
  return normalizeRelativePath(path)
    .split('/')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)
}

/** Build a directory/file tree from flat change entries. */
export function buildSourceControlTree(
  changes: readonly WorkspaceChange[],
): SourceControlTreeNode[] {
  const root = createDirectory('', '', -1)
  for (const change of changes) {
    const segments = splitPathSegments(change.path)
    const fileName = segments.at(-1)
    if (fileName === undefined) continue
    let parent = root
    for (let index = 0; index < segments.length - 1; index += 1) {
      const name = segments[index]!
      const path = segments.slice(0, index + 1).join('/')
      let directory = parent.directories.get(name)
      if (directory === undefined) {
        directory = createDirectory(path, name, index)
        parent.directories.set(name, directory)
        parent.children.push(directory)
      }
      parent = directory
    }
    parent.children.push({
      kind: 'file',
      key: `file:${change.path}`,
      name: fileName,
      path: change.path,
      depth: segments.length - 1,
      change,
    })
  }
  return finalizeDirectory(root)
}

function finalizeDirectory(node: MutableDirectory): SourceControlTreeNode[] {
  const directories: SourceControlTreeNode[] = []
  const files: SourceControlTreeNode[] = []
  for (const child of node.children) {
    if (child.kind === 'directory') {
      directories.push(compactNode({
        ...child,
        children: finalizeDirectory(child),
        fileCount: countFiles(child),
      }))
    } else {
      files.push(child)
    }
  }
  directories.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
  files.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }))
  return [...directories, ...files]
}

function countFiles(node: MutableDirectory): number {
  return node.children.reduce((count, child) => {
    if (child.kind === 'file') return count + 1
    return count + countFiles(child)
  }, 0)
}

/** Merge single-child directory chains (`src/components/x.ts` → `src/components`). */
function compactNode(node: SourceControlDirectoryNode): SourceControlDirectoryNode {
  let current = node
  const names = [node.name]
  while (current.children.length === 1 && current.children[0]?.kind === 'directory') {
    const only = current.children[0]
    current = {
      ...only,
      depth: current.depth,
      children: only.children,
    }
    names.push(only.name)
  }
  return {
    ...current,
    name: names.join('/'),
    children: current.children.map(child =>
      child.kind === 'directory' ? compactNode(child) : child,
    ),
  }
}

/** Flatten the tree into a stable row stream, honoring collapsed directories. */
export function flattenSourceControlTree(
  nodes: readonly SourceControlTreeNode[],
  collapsedDirectoryKeys: ReadonlySet<string>,
): SourceControlTreeNode[] {
  const result: SourceControlTreeNode[] = []
  const visit = (node: SourceControlTreeNode): void => {
    result.push(node)
    if (node.kind === 'directory' && !collapsedDirectoryKeys.has(node.key)) {
      node.children.forEach(visit)
    }
  }
  nodes.forEach(visit)
  return result
}

/** All change entries under a node (section/directory batch operations). */
export function collectChangeEntries(
  node: SourceControlTreeNode,
): WorkspaceChange[] {
  if (node.kind === 'file') return [node.change]
  return node.children.flatMap(collectChangeEntries)
}

export function collectStagePaths(
  node: SourceControlTreeNode,
): string[] {
  return collectChangeEntries(node)
    .filter(canStageChange)
    .map(change => change.path)
}

export function collectUnstagePaths(
  node: SourceControlTreeNode,
): string[] {
  return collectChangeEntries(node)
    .filter(canUnstageChange)
    .map(change => change.path)
}

export function collectDiscardPaths(
  node: SourceControlTreeNode,
): string[] {
  return collectChangeEntries(node)
    .filter(canDiscardChange)
    .map(change => change.path)
}

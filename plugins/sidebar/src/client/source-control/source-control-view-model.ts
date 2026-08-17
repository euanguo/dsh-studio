/**
 * Source-control panel view model (pure functions, no React).
 *
 * Builds the flat row stream the panel renders: collapsible sections
 * (conflict → staged → unstaged → untracked), directory rows with depth,
 * and file rows with per-row capabilities. All state is input — the panel
 * owns nothing but the collapsed sets and the selection.
 */
import type { WorkspaceChange } from '../../protocol.ts'
import { basename } from '@oh-dsh/shared/path'
import {
  buildSourceControlTree,
  canDiscardChange,
  canStageChange,
  canUnstageChange,
  collectDiscardPaths,
  collectStagePaths,
  collectUnstagePaths,
  flattenSourceControlTree,
  sectionOfChange,
  SECTION_ORDER,
  type SourceControlSectionId,
  type SourceControlTreeNode,
} from './source-control-tree.ts'

export interface SectionRow {
  kind: 'section'
  key: string
  id: SourceControlSectionId
  count: number
  expanded: boolean
  stagePaths: string[]
  unstagePaths: string[]
  discardPaths: string[]
}

export interface DirectoryRow {
  kind: 'directory'
  key: string
  name: string
  path: string
  depth: number
  fileCount: number
  expanded: boolean
  stagePaths: string[]
  unstagePaths: string[]
  discardPaths: string[]
}

export interface FileRow {
  kind: 'file'
  key: string
  name: string
  path: string
  depth: number
  change: WorkspaceChange
  selected: boolean
  canStage: boolean
  canUnstage: boolean
  canDiscard: boolean
}

export type SourceControlVisibleRow =
  | SectionRow
  | DirectoryRow
  | FileRow

/** Display mode of the change list: flat (one row per file) or tree. */
export type SourceControlListMode = 'flat' | 'tree'

export interface SourceControlViewModelInput {
  changes: readonly WorkspaceChange[]
  collapsedSections: ReadonlySet<SourceControlSectionId>
  collapsedDirectories: ReadonlySet<string>
  selectedPath: string | null
  /** 'tree' groups files under directory rows; 'flat' lists them plainly. */
  mode: SourceControlListMode
}

function sectionBatchPaths(
  nodes: readonly SourceControlTreeNode[],
  pick: (node: SourceControlTreeNode) => string[],
): string[] {
  return nodes.flatMap(pick)
}

/** Build the visible row stream for one snapshot. */
export function buildSourceControlRows(
  input: SourceControlViewModelInput,
): SourceControlVisibleRow[] {
  const rows: SourceControlVisibleRow[] = []
  const changesBySection = new Map<SourceControlSectionId, WorkspaceChange[]>()
  for (const change of input.changes) {
    const section = sectionOfChange(change)
    const list = changesBySection.get(section)
    if (list === undefined) changesBySection.set(section, [change])
    else list.push(change)
  }

  for (const section of SECTION_ORDER) {
    const changes = changesBySection.get(section) ?? []
    // Skip empty sections (orca parity): a clean area contributes no header row.
    if (changes.length === 0) continue
    const expanded = !input.collapsedSections.has(section)
    const tree = buildSourceControlTree(changes)
    // Both sections can contain identical directory paths (and therefore
    // identical node keys). Prefix row keys with the section so React keys
    // stay unique across the whole row stream — duplicate keys made React
    // keep stale DOM rows around on every collapse/expand.
    const keyFor = (key: string): string => `${section}:${key}`
    rows.push({
      kind: 'section',
      key: `section:${section}`,
      id: section,
      count: changes.length,
      expanded,
      stagePaths: sectionBatchPaths(tree, collectStagePaths),
      unstagePaths: sectionBatchPaths(tree, collectUnstagePaths),
      discardPaths: sectionBatchPaths(tree, collectDiscardPaths),
    })
    if (!expanded || changes.length === 0) continue

    if (input.mode === 'flat') {
      // One plain row per change — no directory grouping. Depth is always 0;
      // the basename is shown, the full path is the row title.
      for (const change of changes) {
        const name = basename(change.path)
        rows.push({
          kind: 'file',
          key: keyFor(`file:${change.path}`),
          name,
          path: change.path,
          depth: 0,
          change,
          selected: input.selectedPath === change.path,
          canStage: canStageChange(change),
          canUnstage: canUnstageChange(change),
          canDiscard: canDiscardChange(change),
        })
      }
      continue
    }

    for (const node of flattenSourceControlTree(tree, input.collapsedDirectories, `${section}:`)) {
      if (node.kind === 'file') {
        rows.push({
          kind: 'file',
          key: keyFor(node.key),
          name: node.name,
          path: node.path,
          depth: node.depth,
          change: node.change,
          selected: input.selectedPath === node.change.path,
          canStage: canStageChange(node.change),
          canUnstage: canUnstageChange(node.change),
          canDiscard: canDiscardChange(node.change),
        })
      } else {
        rows.push({
          kind: 'directory',
          key: keyFor(node.key),
          name: node.name,
          path: node.path,
          depth: node.depth,
          fileCount: node.fileCount,
          expanded: !input.collapsedDirectories.has(keyFor(node.key))
            && !input.collapsedDirectories.has(node.key),
          stagePaths: collectStagePaths(node),
          unstagePaths: collectUnstagePaths(node),
          discardPaths: collectDiscardPaths(node),
        })
      }
    }
  }
  return rows
}

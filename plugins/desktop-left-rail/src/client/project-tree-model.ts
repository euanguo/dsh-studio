import type { SessionId, SessionListState, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { ProjectIconNode, ProjectTree, ProjectTreeView, WorktreeLayoutMap } from './tree.ts'
import { deriveProjectTree } from './tree.ts'

/** One coherent projection consumed by both the tree and project search. */
export interface LeftRailSnapshot {
  readonly tree: ProjectTree
  readonly currentSessionId: SessionId | undefined
}

/** Derive the rail projection once so sibling renderers cannot disagree. */
export function deriveLeftRailSnapshot({
  list,
  workspaces,
  layouts,
  archivedSessionIds,
  view,
  projectIcons,
}: {
  list: SessionListState
  workspaces: readonly WorkspaceView[]
  layouts: WorktreeLayoutMap
  archivedSessionIds: readonly SessionId[]
  view: ProjectTreeView
  projectIcons: ReadonlyMap<string, ProjectIconNode>
}): LeftRailSnapshot {
  return {
    tree: deriveProjectTree(list, workspaces, layouts, archivedSessionIds, view, projectIcons),
    currentSessionId: list.current,
  }
}

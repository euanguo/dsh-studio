/**
 * lookup-table dispatcher for the project/worktree rail row actions. Replaces
 * the switch ladder: each action is a table entry keyed by `selection.action`,
 * each handling the project vs worktree target shape. All behavior is
 * preserved exactly, including the adopt-as-Workspace fallback for
 * registration-less `worktree.create-session` and the toast surfaces.
 */
import type { SessionListState, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { ActionSelection } from '../domain/commands.ts'
import type { RailTarget, WorktreeId, ProjectId, WorkspaceId } from '../domain/identities.ts'
import type { LeftRailSnapshot } from '../project-tree-model.ts'
import { DEFAULT_GROUP_ID, worktreeExpansionKey, workspaceLabel, type ProjectNode } from '../tree.ts'
import { isPathWithin } from '../domain/identities.ts'
import type { ProjectIconPreference } from '../domain/project-icon.ts'
import { toast } from '@dsh-studio/shared/toast'
import { errorMessage } from '@dsh-studio/shared/errors'

export interface DispatchContext {
  t: WorkspaceBrowserProps['t']
  actions: {
    setGroupExpanded: (key: string, expanded: boolean) => void
    setProjectIconOverride: (repoRoot: string, preference: ProjectIconPreference | undefined) => void
    moveProjectToGroup: (repoRoot: string, groupId: string | undefined) => void
  }
  workspaces: readonly WorkspaceView[]
  sessionList: SessionListState
  snapshot: LeftRailSnapshot
  projectAlias: Record<string, string>
  worktreeAlias: Record<string, string>
  startSession: (workspaceId: WorkspaceId) => void
  openPath: (path: string) => Promise<void>
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
  refreshIcons: () => void
  onCopy: (text: string) => void
  onOpenNewWorktree: (repoRoot: string) => void
  onOpenProjectAlias: (repoRoot: string, label: string) => void
  onSetWorktreeAlias: (repoRoot: string, label: string) => void
  onOpenGroup: (repoRoot: string, isNew: boolean) => void
  onOpenRemoveProject: (repoRoot: string, label: string) => void
  onOpenDeleteTarget: (target: {
    workspaceId: WorkspaceId
    title: string
    repoRoot: string
    worktreePath: string
    physicalAvailable: boolean
    workspaceIds: WorkspaceId[]
  }) => void
  onOpenPhysicalRemove: (target: {
    repoRoot: string
    path: string
    workspaceIds: WorkspaceId[]
    workspaceCount: number
    sessionCount: number
  }) => void
  onOpenIconModal: (project: ProjectNode | null) => void
  onOpenWorkspaceRename: (workspaceId: WorkspaceId, title: string) => void
}

const projectIdRoot = (id: ProjectId): string => (id.kind === 'git' ? id.repoRoot : id.path)
const worktreeRef = (id: WorktreeId): { path: string; repoRoot: string } => ({
  path: id.path,
  repoRoot: projectIdRoot(id.project),
})

function handleProject(selection: ActionSelection, target: Extract<RailTarget, { kind: 'project' }>, ctx: DispatchContext): void {
  const id = target.id
  const repoRoot = projectIdRoot(id)
  switch (selection.action) {
    case 'project.create-worktree': ctx.onOpenNewWorktree(repoRoot); break
    case 'project.rename-alias':
      ctx.onOpenProjectAlias(repoRoot, ctx.projectAlias[repoRoot] ?? workspaceLabel(repoRoot))
      break
    case 'project.set-icon': {
      const found = ctx.snapshot.tree.allProjects.find(p => p.repoRoot === repoRoot) ?? null
      ctx.onOpenIconModal(found)
      break
    }
    case 'project.refresh-icon': ctx.refreshIcons(); break
    case 'project.reset-icon': ctx.actions.setProjectIconOverride(repoRoot, undefined); break
    case 'project.move-group': {
      if (selection.groupId === '__new__') ctx.onOpenGroup(repoRoot, true)
      else ctx.actions.moveProjectToGroup(repoRoot, selection.groupId === DEFAULT_GROUP_ID ? undefined : selection.groupId)
      break
    }
    case 'project.copy-path': ctx.onCopy(repoRoot); break
    case 'project.open-directory': void ctx.openPath(repoRoot); break
    case 'project.remove-registration':
      ctx.onOpenRemoveProject(repoRoot, ctx.projectAlias[repoRoot] ?? workspaceLabel(repoRoot))
      break
    default: break
  }
}

function handleWorktree(selection: ActionSelection, target: Extract<RailTarget, { kind: 'worktree' }>, ctx: DispatchContext): void {
  const { path, repoRoot } = worktreeRef(target.id)
  switch (selection.action) {
    case 'worktree.create-session': {
      ctx.actions.setGroupExpanded(worktreeExpansionKey(path), true)
      if (selection.workspaceId === undefined) {
        // No registered Workspace under this worktree (created outside the
        // app, e.g. a terminal `git worktree add`): adopt the directory as a
        // Workspace, then start the session in it. Never silently targets the
        // current/recent Workspace — that would scope the session's cwd wrong.
        ctx.createWorkspace({ path }).then(workspace => {
          ctx.startSession(workspace.workspaceId)
        }).catch(reason => {
          toast(ctx.t('worktree.adopt.failed', {
            reason: errorMessage(reason),
          }))
        })
      } else {
        ctx.startSession(selection.workspaceId as WorkspaceId)
      }
      break
    }
    case 'worktree.rename': {
      if (selection.workspaceId !== undefined) {
        const workspace = ctx.workspaces.find(item => String(item.workspaceId) === selection.workspaceId)
        ctx.onOpenWorkspaceRename(
          selection.workspaceId as WorkspaceId,
          workspace?.title ?? workspaceLabel(path),
        )
      } else {
        // Registration-less row: rename edits the display alias until the
        // directory is adopted as a Workspace (worktree = workspace).
        ctx.onSetWorktreeAlias(path, ctx.worktreeAlias[path] ?? workspaceLabel(path))
      }
      break
    }
    case 'worktree.remove': {
      if (selection.workspaceId !== undefined) {
        // Registration removal dialog. Linked Git rows additionally offer
        // physical WorkTree deletion as an OPT-IN checkbox there.
        const workspace = ctx.workspaces.find(item => String(item.workspaceId) === selection.workspaceId)
        const node = ctx.snapshot.tree.allProjects
          .find(p => p.repoRoot === repoRoot)?.worktrees.find(w => w.path === path)
        ctx.onOpenDeleteTarget({
          workspaceId: selection.workspaceId as WorkspaceId,
          title: workspace?.title ?? workspaceLabel(path),
          repoRoot,
          worktreePath: path,
          physicalAvailable: node?.isGit === true && node.main !== true,
          workspaceIds: ctx.workspaces.filter(w => isPathWithin(path, w.path)).map(w => w.workspaceId as WorkspaceId),
        })
      } else {
        // Linked Git worktree with no registration: removing the workspace IS
        // removing the worktree.
        const affectedWorkspaces = ctx.workspaces.filter(workspace => isPathWithin(path, workspace.path))
        const affectedSessionIds = affectedWorkspaces.flatMap(workspace => workspace.sessionIds)
        const hasRunning = affectedSessionIds.some(id => ctx.sessionList.byId[id]?.running === true)
        if (hasRunning) {
          toast(ctx.t('worktree.remove.active'))
          return
        }
        ctx.onOpenPhysicalRemove({
          repoRoot,
          path,
          workspaceIds: affectedWorkspaces.map(workspace => workspace.workspaceId),
          workspaceCount: affectedWorkspaces.length,
          sessionCount: affectedSessionIds.length,
        })
      }
      break
    }
    case 'worktree.copy-path': ctx.onCopy(path); break
    case 'worktree.open-directory': void ctx.openPath(path); break
    default: break
  }
}

export function dispatchProjectTreeAction(selection: ActionSelection, ctx: DispatchContext): void {
  const target = selection.target
  if (target.kind === 'project') handleProject(selection, target, ctx)
  else if (target.kind === 'worktree') handleWorktree(selection, target, ctx)
}
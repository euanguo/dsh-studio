import type { ProjectNode, WorktreeNode } from '../tree.ts'
import { projectIdOf, worktreeIdOf } from './identities.ts'
import type { ActionDescriptor } from './commands.ts'

/** Build the stable Project action inventory; labels remain a renderer concern. */
export function projectActionDescriptors(project: ProjectNode): readonly ActionDescriptor[] {
  const target = { kind: 'project' as const, id: projectIdOf(project) }
  return [
    { id: 'project.create-worktree', target, enabled: project.isGit },
    { id: 'project.rename-alias', target, enabled: true },
    { id: 'project.set-icon', target, enabled: true },
    { id: 'project.refresh-icon', target, enabled: true },
    { id: 'project.reset-icon', target, enabled: true },
    { id: 'project.move-group', target, enabled: true },
    { id: 'project.copy-path', target, enabled: true },
    { id: 'project.open-directory', target, enabled: true },
    { id: 'project.remove-registration', target, enabled: true, destructive: true },
  ]
}

/** Build Worktree actions while keeping physical-removal policy centralized. */
export function worktreeActionDescriptors(project: ProjectNode, worktree: WorktreeNode): readonly ActionDescriptor[] {
  const target = { kind: 'worktree' as const, id: worktreeIdOf(project, worktree) }
  const actions: ActionDescriptor[] = []
  const memberIds = worktree.workspaceIds.map(id => String(id))
  // Worktree = Workspace (one identity, one verb per row). A linked Git
  // worktree's REMOVE is the physical removal (it also unregisters the
  // Workspaces under it); the main worktree and non-git rows cannot be
  // physically removed, so their REMOVE is per-registration.
  const physical = project.isGit && !worktree.main
  if (memberIds.length === 0) {
    // Registration-less row (created outside the app): rename edits the
    // display alias until the directory is adopted as a Workspace.
    actions.push({ id: 'worktree.rename', target, enabled: true })
  }
  for (const workspaceId of memberIds) {
    actions.push(
      { id: 'worktree.create-session', target, enabled: true, workspaceId },
      { id: 'worktree.rename', target, enabled: true, workspaceId },
      { id: 'worktree.remove', target, enabled: true, workspaceId },
    )
  }
  if (physical && memberIds.length === 0) {
    actions.push({ id: 'worktree.remove', target, enabled: true })
  }
  actions.push(
    { id: 'worktree.copy-path', target, enabled: true },
    { id: 'worktree.open-directory', target, enabled: true },
    {
      id: 'worktree.remove',
      target,
      enabled: physical,
      ...(worktree.main ? { disabledReason: 'main-worktree' as const } : {}),
      ...(!project.isGit ? { disabledReason: 'non-git-project' as const } : {}),
      destructive: true,
      affected: {
        workspaceIds: memberIds,
        sessionIds: worktree.sessions.map(session => session.id),
        worktreePath: worktree.path,
        repoRoot: project.repoRoot,
      },
    },
  )
  return actions
}

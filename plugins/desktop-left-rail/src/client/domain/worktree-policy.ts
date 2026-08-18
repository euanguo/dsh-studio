import type { ProjectNode, WorktreeNode } from '../tree.ts'
import type { GitFactState, RailError } from './identities.ts'

export type WorktreeRemovalDecision =
  | { eligible: true; requiresConfirmation: boolean; reason: 'linked-worktree' | 'linked-worktree-with-sessions' }
  | { eligible: false; reason: WorktreeRemovalReason; error: RailError }

export type WorktreeRemovalReason =
  | 'main-worktree'
  | 'non-git-project'
  | 'git-facts-unavailable'
  | 'stale-target'
  | 'active-session'

export interface WorktreeRemovalContext {
  readonly project: Pick<ProjectNode, 'isGit' | 'repoRoot'>
  readonly worktree: Pick<WorktreeNode, 'path' | 'main' | 'workspaceIds' | 'sessions'>
  readonly gitFact: GitFactState | undefined
  readonly targetIsCurrent: boolean
}

function policyError(reason: WorktreeRemovalReason, message: string): RailError {
  return { code: reason === 'git-facts-unavailable' ? 'git-unavailable' : reason, message }
}

/** Pure client policy; host must revalidate the target before deleting it. */
export function getWorktreeRemovalDecision(context: WorktreeRemovalContext): WorktreeRemovalDecision {
  if (!context.project.isGit) {
    return { eligible: false, reason: 'non-git-project', error: policyError('non-git-project', 'A non-Git directory has no physical worktree to remove.') }
  }
  if (context.worktree.main) {
    return { eligible: false, reason: 'main-worktree', error: policyError('main-worktree', 'The main worktree cannot be removed.') }
  }
  if (context.gitFact?.status !== 'ready' || context.gitFact.kind !== 'git') {
    return { eligible: false, reason: 'git-facts-unavailable', error: policyError('git-facts-unavailable', 'Current Git worktree facts are unavailable.') }
  }
  const known = context.gitFact.layout.worktrees.some(worktree => worktree.path === context.worktree.path)
  if (!known) {
    return { eligible: false, reason: 'stale-target', error: policyError('stale-target', 'The worktree changed before removal could be confirmed.') }
  }
  if (context.targetIsCurrent || context.worktree.sessions.some(session => session.running)) {
    return { eligible: false, reason: 'active-session', error: policyError('active-session', 'A running session must be stopped before removing this worktree.') }
  }
  return {
    eligible: true,
    requiresConfirmation: context.worktree.sessions.length > 0 || context.worktree.workspaceIds.length > 0,
    reason: context.worktree.sessions.length > 0 ? 'linked-worktree-with-sessions' : 'linked-worktree',
  }
}

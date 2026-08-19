import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ProjectIconBuiltin } from './project-icon.ts'
import type { RailError, RailTarget, WorktreeId } from './identities.ts'

export type RailActionId =
  | 'project.create-worktree'
  | 'project.rename-alias'
  | 'project.set-icon'
  | 'project.refresh-icon'
  | 'project.reset-icon'
  | 'project.move-group'
  | 'project.copy-path'
  | 'project.open-directory'
  | 'project.remove-registration'
  | 'worktree.create-session'
  /** One rename verb per row: a workspaceId renames that Workspace; without one (registration-less row) it renames the display alias. */
  | 'worktree.rename'
  /** One remove verb per row: a workspaceId removes that registration; without one it removes the physical Git worktree (and its registrations). */
  | 'worktree.remove'
  | 'worktree.copy-path'
  | 'worktree.open-directory'
  | 'session.open'
  | 'session.rename'
  | 'session.fork'
  | 'session.archive'
  | 'session.move-before'

export type RailDisabledReason =
  | 'git-facts-unavailable'
  | 'main-worktree'
  | 'non-git-project'
  | 'stale-target'
  | 'active-session'
  | 'selection-required'
  | 'not-applicable'

export interface ConfirmationPolicy {
  readonly kind: 'risk' | 'informational'
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
}

export interface AffectedResources {
  readonly workspaceIds?: readonly string[]
  readonly sessionIds?: readonly SessionId[]
  readonly worktreePath?: string
  readonly repoRoot?: string
}

export interface ActionDescriptor {
  readonly id: RailActionId
  readonly target: RailTarget
  readonly enabled: boolean
  readonly disabledReason?: RailDisabledReason
  readonly destructive?: boolean
  readonly confirmation?: ConfirmationPolicy
  readonly affected?: AffectedResources
  readonly workspaceId?: string
}

export interface ActionSelection {
  readonly action: RailActionId
  readonly target: RailTarget
  readonly workspaceId?: string
  readonly groupId?: string
  readonly iconName?: ProjectIconBuiltin
  readonly iconData?: string
}

export type RailCommand =
  | { kind: 'project.create-worktree'; target: Extract<RailTarget, { kind: 'project' }>; path: string; branch?: string }
  | { kind: 'project.rename-alias'; target: Extract<RailTarget, { kind: 'project' }>; alias: string }
  | { kind: 'project.set-icon'; target: Extract<RailTarget, { kind: 'project' }>; icon: ProjectIconInput }
  | { kind: 'project.refresh-icon'; target: Extract<RailTarget, { kind: 'project' }> }
  | { kind: 'project.reset-icon'; target: Extract<RailTarget, { kind: 'project' }> }
  | { kind: 'project.move-group'; target: Extract<RailTarget, { kind: 'project' }>; groupId: string }
  | { kind: 'project.copy-path'; target: Extract<RailTarget, { kind: 'project' }> }
  | { kind: 'project.open-directory'; target: Extract<RailTarget, { kind: 'project' }> }
  | { kind: 'project.remove-registration'; target: Extract<RailTarget, { kind: 'project' }> }
  | { kind: 'worktree.create-session'; target: Extract<RailTarget, { kind: 'worktree' }>; workspaceId?: string }
  | { kind: 'worktree.rename'; target: Extract<RailTarget, { kind: 'worktree' }>; workspaceId?: string; title: string }
  | { kind: 'worktree.remove'; target: Extract<RailTarget, { kind: 'worktree' }>; workspaceId?: string }
  | { kind: 'worktree.copy-path'; target: Extract<RailTarget, { kind: 'worktree' }> }
  | { kind: 'worktree.open-directory'; target: Extract<RailTarget, { kind: 'worktree' }> }
  | { kind: 'session.open'; target: Extract<RailTarget, { kind: 'session' }> }
  | { kind: 'session.rename'; target: Extract<RailTarget, { kind: 'session' }>; title: string }
  | { kind: 'session.fork'; target: Extract<RailTarget, { kind: 'session' }> }
  | { kind: 'session.archive'; target: Extract<RailTarget, { kind: 'session' }> }
  | { kind: 'session.move-before'; target: Extract<RailTarget, { kind: 'session' }>; beforeSessionId?: SessionId }

export type ProjectIconInput =
  | { kind: 'builtin'; name: ProjectIconBuiltin }
  | { kind: 'upload'; mime: 'image/png'; data: string }

export interface RailCommandResult {
  readonly ok: true
  readonly command: RailCommand
  readonly refreshed: boolean
  readonly affected?: AffectedResources
}

export interface RailCommandFailure {
  readonly ok: false
  readonly command: RailCommand
  readonly error: RailError
  readonly recovery?: RecoveryResult
}

export type RailActionResult = RailCommandResult | RailCommandFailure

export interface RecoveryResult {
  readonly cleanedWorkspaceIds: readonly string[]
  readonly failedWorkspaceIds: readonly string[]
}

export type { RailError, RailTarget, WorktreeId }

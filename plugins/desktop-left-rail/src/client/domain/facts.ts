import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { GitWorktreeLayout } from '../tree.ts'
import type { RailError } from './identities.ts'

/** Runtime facts needed to derive one coherent left-rail snapshot. */
export interface RailFactsSnapshot {
  readonly git: ReadonlyMap<string, GitFactState>
  readonly workspaces: readonly WorkspaceFact[]
  readonly sessions: readonly SessionFact[]
}

/** A runtime Workspace fact, intentionally independent from rendered rows. */
export interface WorkspaceFact {
  readonly id: WorkspaceId
  readonly cwd: string
  readonly sessionIds: readonly SessionId[]
}

/** The subset of Session facts relevant to topology policies. */
export interface SessionFact {
  readonly id: SessionId
  readonly workspaceId?: WorkspaceId
  readonly running: boolean
}

export type GitFactState =
  | { status: 'ready'; kind: 'git'; layout: GitWorktreeLayout }
  | { status: 'ready'; kind: 'directory' }
  | { status: 'loading'; lastKnown?: GitWorktreeLayout }
  | { status: 'error'; lastKnown?: GitWorktreeLayout; error: RailError }

/** Whether a fact can authorize topology-changing actions. */
export function hasFreshGitTopology(fact: GitFactState | undefined): boolean {
  return fact?.status === 'ready' && fact.kind === 'git'
}

/** Return the latest known layout without confusing it with a fresh fact. */
export function lastKnownGitLayout(fact: GitFactState | undefined): GitWorktreeLayout | undefined {
  if (fact?.status === 'ready' && fact.kind === 'git') return fact.layout
  if (fact?.status === 'loading' || fact?.status === 'error') return fact.lastKnown
  return undefined
}

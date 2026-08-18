import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { GitWorktreeLayout, ProjectNode, WorktreeNode } from '../tree.ts'

/** A canonical repository or directory identity used across rail modules. */
export type ProjectId =
  | { kind: 'git'; repoRoot: string }
  | { kind: 'directory'; path: string }

/** A canonical physical worktree identity within a project. */
export interface WorktreeId {
  project: ProjectId
  path: string
}

/** A semantic target addressed by a rail action. */
export type RailTarget =
  | { kind: 'project'; id: ProjectId }
  | { kind: 'worktree'; id: WorktreeId }
  | { kind: 'session'; id: SessionId }

/** The path representation expected from host/runtime adapters. */
export type PathLike = string

/** Normalize separators and lexical dot segments without touching the filesystem. */
export function normalizePath(path: PathLike): string {
  const replaced = path.replaceAll('\\', '/')
  const prefix = replaced.startsWith('/') ? '/' : ''
  const drive = /^[A-Za-z]:\//.test(replaced) ? replaced.slice(0, 3) : ''
  const body = drive === '' ? replaced : replaced.slice(3)
  const parts: string[] = []
  for (const part of body.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
      else if (prefix === '' && drive === '') parts.push(part)
      continue
    }
    parts.push(part)
  }
  const root = drive !== '' ? drive : prefix
  const normalized = `${root}${parts.join('/')}`
  if (normalized !== '' && normalized !== '/' && /\/$/.test(replaced)) return normalized
  return normalized || (prefix || drive || '.')
}

/** Return true when child is path-equal to or below parent on a segment boundary. */
export function isPathWithin(parent: PathLike, child: PathLike): boolean {
  const normalizedParent = normalizePath(parent).replace(/\/$/, '') || '/'
  const normalizedChild = normalizePath(child).replace(/\/$/, '') || '/'
  return normalizedChild === normalizedParent
    || normalizedChild.startsWith(`${normalizedParent}/`)
}

/** Construct a project identity using its canonical host-provided root/path. */
export function projectIdOf(project: Pick<ProjectNode, 'repoRoot' | 'isGit'>): ProjectId {
  return project.isGit
    ? { kind: 'git', repoRoot: normalizePath(project.repoRoot) }
    : { kind: 'directory', path: normalizePath(project.repoRoot) }
}

/** Construct a worktree identity compatible with the existing tree node. */
export function worktreeIdOf(project: ProjectNode, worktree: Pick<WorktreeNode, 'path'>): WorktreeId {
  return { project: projectIdOf(project), path: normalizePath(worktree.path) }
}

/** Stable, namespaced key for a project identity. */
export function projectIdentityKey(id: ProjectId): string {
  return id.kind === 'git' ? `git:${normalizePath(id.repoRoot)}` : `directory:${normalizePath(id.path)}`
}

/** Stable, namespaced key for a worktree identity. */
export function worktreeIdentityKey(id: WorktreeId): string {
  return `${projectIdentityKey(id.project)}:worktree:${normalizePath(id.path)}`
}

/** Stable expansion key; renderers should not concatenate path strings themselves. */
export function railExpansionKey(target: RailTarget): string {
  switch (target.kind) {
    case 'project': return `project:${projectIdentityKey(target.id)}`
    case 'worktree': return `worktree:${worktreeIdentityKey(target.id)}`
    case 'session': return `session:${String(target.id)}`
  }
}

/** A Git fact whose layout is known to be current enough for topology actions. */
export interface ReadyGitFact {
  status: 'ready'
  kind: 'git'
  layout: GitWorktreeLayout
}

/** A confirmed directory that is not a Git worktree. */
export interface ReadyDirectoryFact {
  status: 'ready'
  kind: 'directory'
}

/** A transient Git query state, retaining the last successful layout when known. */
export interface LoadingGitFact {
  status: 'loading'
  lastKnown?: GitWorktreeLayout
}

/** A failed Git query state, retaining the last successful layout when known. */
export interface ErrorGitFact {
  status: 'error'
  lastKnown?: GitWorktreeLayout
  error: RailError
}

export type GitFactState = ReadyGitFact | ReadyDirectoryFact | LoadingGitFact | ErrorGitFact

/** Structured domain failure shared by fact and command contracts. */
export interface RailError {
  code: RailErrorCode
  message: string
  cause?: unknown
}

export type RailErrorCode =
  | 'git-unavailable'
  | 'invalid-target'
  | 'stale-target'
  | 'main-worktree'
  | 'non-git-worktree'
  | 'non-git-project'
  | 'active-session'
  | 'workspace-selection-required'
  | 'command-failed'

export type { GitWorktreeLayout, ProjectNode, WorktreeNode, SessionId, WorkspaceId }

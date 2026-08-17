import type {
  WorkspaceChange,
  WorkspaceFilesResponse,
} from '../protocol.ts'
import {
  callSidebarApi as sharedCallSidebarApi,
  callSidebarGlobalApi as sharedCallSidebarGlobalApi,
  type SidebarApiMethod,
  type SidebarApiRequests,
  type SidebarFsEntry,
  type SidebarFsRead,
  type SidebarFsTree,
  type SidebarGitBranch,
  type SidebarGitCommitFile,
  type SidebarGitCommitted,
  type SidebarGitLogEntry,
  type SidebarGitStat,
  type SidebarGitStatus,
  type SidebarGitStatusEntry,
  type SidebarScope,
  type SidebarSettingsView,
} from '../../../shared/sidebar-api.ts'
import { normalizePath } from '../../../shared/path.ts'

/**
 * The client face of the sidebar API. All calls go to the generic host's
 * /sidebar/api route; the wire contract, DTOs, and call helpers are shared
 * through @oh-dsh/shared so the two halves cannot drift.
 */
export type {
  SidebarFsEntry,
  SidebarFsRead,
  SidebarFsTree,
  SidebarGitBranch,
  SidebarGitCommitFile,
  SidebarGitCommitted,
  SidebarGitLogEntry,
  SidebarGitStatus,
  SidebarGitStatusEntry,
  SidebarScope,
  SidebarSettingsView,
} from '../../../shared/sidebar-api.ts'

/**
 * Wire call typed by the shared request DTOs: the method name and its
 * payload shape come from the same SidebarApiRequests map the host parses
 * against, so a client/host drift is a compile error, not a runtime bug.
 */
function callSidebarApi<M extends SidebarApiMethod, T>(
  method: M,
  scope: SidebarScope,
  payload: SidebarApiRequests[M],
  signal?: AbortSignal,
): Promise<T> {
  return sharedCallSidebarApi(method, scope, payload as Record<string, unknown>, signal)
}

/** Global (scope-less) wire call, typed by the shared request DTOs. */
function callSidebarGlobalApi<M extends SidebarApiMethod, T>(
  method: M,
  payload: SidebarApiRequests[M],
  signal?: AbortSignal,
): Promise<T> {
  return sharedCallSidebarGlobalApi(method, payload as Record<string, unknown>, signal)
}

export const sidebarApi = {
  fsRead: (
    scope: SidebarScope,
    path: string,
    signal?: AbortSignal,
  ): Promise<SidebarFsRead> => callSidebarApi('fs.read', scope, { path }, signal),
  fsWrite: (
    scope: SidebarScope,
    path: string,
    content: string,
  ): Promise<{ ok: boolean }> => callSidebarApi('fs.write', scope, { path, content }),
  fsCreate: (
    scope: SidebarScope,
    path: string,
    directory: boolean,
  ): Promise<{ ok: boolean }> => callSidebarApi('fs.create', scope, { path, directory }),
  fsRename: (
    scope: SidebarScope,
    from: string,
    to: string,
  ): Promise<{ ok: boolean }> => callSidebarApi('fs.rename', scope, { from, to }),
  fsDelete: (
    scope: SidebarScope,
    path: string,
  ): Promise<{ ok: boolean }> => callSidebarApi('fs.delete', scope, { path }),
  fsCopy: (
    scope: SidebarScope,
    from: string,
    to: string,
  ): Promise<{ ok: boolean }> => callSidebarApi('fs.copy', scope, { from, to }),
  fsSearch: (
    scope: SidebarScope,
    pattern: string,
    caseSensitive: boolean,
    signal?: AbortSignal,
  ): Promise<Array<{ path: string; line: number; text: string }>> => callSidebarApi(
    'fs.search',
    scope,
    { pattern, caseSensitive },
    signal,
  ),
  fsTail: (
    scope: SidebarScope,
    path: string,
    maxBytes?: number,
    signal?: AbortSignal,
  ): Promise<{ content: string; truncated: boolean }> => callSidebarApi(
    'fs.tail',
    scope,
    { path, ...(maxBytes === undefined ? {} : { maxBytes }) },
    signal,
  ),
  fsTree: (
    scope: SidebarScope,
    path: string,
    signal?: AbortSignal,
  ): Promise<SidebarFsTree> => callSidebarApi('fs.tree', scope, { path }, signal),
  gitBranch: (
    scope: SidebarScope,
    signal?: AbortSignal,
  ): Promise<SidebarGitBranch> => callSidebarApi('git.branch', scope, {}, signal),
  gitCheckout: (
    scope: SidebarScope,
    branch: string,
  ): Promise<void> => callSidebarApi('git.checkout', scope, { branch }),
  gitCommit: (
    scope: SidebarScope,
    message: string,
  ): Promise<void> => callSidebarApi('git.commit', scope, { message }),
  gitCommitDiff: (
    scope: SidebarScope,
    hash: string,
    signal?: AbortSignal,
  ): Promise<{ diff: string }> => callSidebarApi(
    'git.commit-diff',
    scope,
    { hash },
    signal,
  ),
  gitCommitFiles: (
    scope: SidebarScope,
    hash: string,
    signal?: AbortSignal,
  ): Promise<SidebarGitCommitFile[]> => callSidebarApi(
    'git.commit-files',
    scope,
    { hash },
    signal,
  ),
  gitCommitFileDiff: (
    scope: SidebarScope,
    hash: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<{ diff: string }> => callSidebarApi(
    'git.commit-file-diff',
    scope,
    { hash, path },
    signal,
  ),
  gitCommittedFiles: (
    scope: SidebarScope,
    signal?: AbortSignal,
  ): Promise<SidebarGitCommitted> => callSidebarApi(
    'git.committed-files',
    scope,
    {},
    signal,
  ),
  gitCommittedDiff: (
    scope: SidebarScope,
    baseRef: string,
    path: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ diff: string }> => callSidebarApi(
    'git.committed-diff',
    scope,
    { baseRef, ...(path === undefined ? {} : { path }) },
    signal,
  ),
  gitDiff: (
    scope: SidebarScope,
    path: string | undefined,
    staged: boolean,
    signal?: AbortSignal,
    context?: number,
  ): Promise<{ diff: string }> => callSidebarApi('git.diff', scope, {
    ...(path === undefined ? {} : { path }),
    staged,
    ...(context === undefined ? {} : { context }),
  }, signal),
  gitImageDiff: (
    scope: SidebarScope,
    path: string,
    staged: boolean,
    signal?: AbortSignal,
  ): Promise<{ oldData: string; newData: string }> => callSidebarApi('git.image-diff', scope, {
    path,
    staged,
  }, signal),
  gitLog: (
    scope: SidebarScope,
    count = 30,
    skip = 0,
    signal?: AbortSignal,
  ): Promise<SidebarGitLogEntry[]> => callSidebarApi('git.log', scope, {
    count,
    skip,
  }, signal),
  gitStage: (
    scope: SidebarScope,
    paths?: string | readonly string[],
  ): Promise<void> => callSidebarApi('git.stage', scope, {
    ...(paths === undefined ? {} : { paths: toPathList(paths) }),
  }),
  gitUnstage: (
    scope: SidebarScope,
    paths?: string | readonly string[],
  ): Promise<void> => callSidebarApi('git.unstage', scope, {
    ...(paths === undefined ? {} : { paths: toPathList(paths) }),
  }),
  gitDiscard: (
    scope: SidebarScope,
    paths: string | readonly string[],
  ): Promise<void> => callSidebarApi('git.discard', scope, {
    paths: toPathList(paths),
  }),
  gitStatus: (
    scope: SidebarScope,
    signal?: AbortSignal,
  ): Promise<SidebarGitStatus> => callSidebarApi('git.status', scope, {}, signal),
  settingsGet: (
    signal?: AbortSignal,
  ): Promise<SidebarSettingsView> => callSidebarGlobalApi(
    'settings.get',
    {},
    signal,
  ),
  settingsUpdate: (
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<SidebarSettingsView> => callSidebarGlobalApi('settings.update', {
    patch,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  }),
  jobOutput: (
    scope: SidebarScope,
    id: string,
    signal?: AbortSignal,
  ): Promise<{ text: string; truncated: boolean; read: boolean }> => callSidebarApi(
    'jobs.output',
    scope,
    { id },
    signal,
  ),
  jobKill: (
    scope: SidebarScope,
    id: string,
    reason?: string,
  ): Promise<{ ok: true; outcome: 'requested' | 'already-finished' }> => {
    const payload: SidebarApiRequests['jobs.kill'] = { id }
    if (reason !== undefined && reason !== '') payload.reason = reason
    return callSidebarApi('jobs.kill', scope, payload)
  },
}

function statusFromCode(code: string): WorkspaceChange['status'] {
  if (code === '??') return 'untracked'
  if (code.includes('U') || code === 'AA' || code === 'DD') {
    return 'conflicted'
  }
  if (code.includes('R')) return 'renamed'
  if (code.includes('C')) return 'copied'
  if (code.includes('D')) return 'deleted'
  if (code.includes('A')) return 'added'
  return 'modified'
}

export function workspaceChangesFromWire(
  entries: readonly SidebarGitStatusEntry[],
  stats?: readonly SidebarGitStat[],
): WorkspaceChange[] {
  const statsByPath = new Map(
    (stats ?? []).map(stat => [stat.path, stat] as const),
  )
  return entries.map(entry => {
    const stat = statsByPath.get(entry.path)
    // Porcelain v2 XY: X = index status, Y = worktree status. An unmodified
    // index slot is '.', so only a letter in X means staged. (v1 used ' ' —
    // keep accepting it for any legacy callers.)
    const indexCode = entry.xy[0] ?? ''
    const staged = indexCode !== '.' && indexCode !== '?' && indexCode !== ' '
    return {
      path: entry.path,
      oldPath: null,
      status: statusFromCode(entry.xy),
      staged,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
    }
  }).sort((left, right) => left.path.localeCompare(right.path))
}

function normalizedPath(path: string): string {
  return normalizePath(path)
}

/** Normalize a single path or a path list into a plain string[]. */
function toPathList(paths: string | readonly string[]): string[] {
  return typeof paths === 'string' ? [paths] : [...paths]
}

function workspaceParent(cwd: string, path: string): string | null {
  const root = normalizedPath(cwd)
  const current = normalizedPath(path)
  if (current === root || !current.startsWith(`${root}/`)) return null
  const parent = current.slice(0, current.lastIndexOf('/'))
  return parent.length >= root.length ? parent : null
}

export function mapSidebarTree(
  cwd: string,
  listing: SidebarFsTree,
): WorkspaceFilesResponse {
  return {
    kind: 'directory',
    cwd,
    path: listing.path,
    parent: workspaceParent(cwd, listing.path),
    entries: listing.entries.map(entry => ({
      kind: entry.isDir ? 'directory' : 'file',
      name: entry.name,
      path: entry.path,
      size: null,
    })),
    truncated: listing.truncated,
  }
}

export function mapSidebarFile(
  cwd: string,
  path: string,
  result: SidebarFsRead,
): WorkspaceFilesResponse {
  if (result.kind === 'binary') {
    return {
      kind: 'file',
      cwd,
      path,
      parent: workspaceParent(cwd, path) ?? cwd,
      content: null,
      binary: true,
      size: result.size,
      truncated: result.truncated,
    }
  }
  return {
    kind: 'file',
    cwd,
    path,
    parent: workspaceParent(cwd, path) ?? cwd,
    content: result.content,
    binary: false,
    size: new TextEncoder().encode(result.content).byteLength,
    truncated: result.truncated,
  }
}

import type {
  WorkspaceChange,
  WorkspaceFilesResponse,
} from '../protocol.ts'
import {
  callCapabilitiesApi as sharedCallCapabilitiesApi,
  callCapabilitiesGlobalApi as sharedCallCapabilitiesGlobalApi,
  type CapabilitiesApiMethod,
  type CapabilitiesApiRequests,
  type CapabilitiesFsEntry,
  type CapabilitiesFsRead,
  type CapabilitiesFsTree,
  type CapabilitiesGitBranch,
  type CapabilitiesGitCommitFile,
  type CapabilitiesGitCommitted,
  type CapabilitiesGitLogEntry,
  type CapabilitiesGitStat,
  type CapabilitiesGitStatus,
  type CapabilitiesGitStatusEntry,
  type CapabilitiesGitUpstreamStatus,
  type CapabilitiesSourceControlAiModels,
  type CapabilitiesScope,
  type CapabilitiesSettingsView,
  type CapabilitiesWorkspaceFacts,
  type CapabilitiesWorkspaceMutation,
  type CapabilitiesWorkspaceMutationResponse,
} from '@dsh-studio/shared/capabilities-api'
import { normalizePath } from '@dsh-studio/shared/path'

/**
 * The client face of the sidebar API. All calls go to the generic host's
 * /capabilities/api route; the wire contract, DTOs, and call helpers are shared
 * through @dsh-studio/shared so the two halves cannot drift.
 */
export type {
  CapabilitiesFsEntry,
  CapabilitiesFsRead,
  CapabilitiesFsTree,
  CapabilitiesGitBranch,
  CapabilitiesGitCommitFile,
  CapabilitiesGitCommitted,
  CapabilitiesGitLogEntry,
  CapabilitiesGitStatus,
  CapabilitiesGitStatusEntry,
  CapabilitiesSourceControlAiModels,
  CapabilitiesScope,
  CapabilitiesSettingsView,
  CapabilitiesWorkspaceFacts,
  CapabilitiesWorkspaceMutation,
  CapabilitiesWorkspaceMutationResponse,
} from '@dsh-studio/shared/capabilities-api'

/**
 * Wire call typed by the shared request DTOs: the method name and its
 * payload shape come from the same CapabilitiesApiRequests map the host parses
 * against, so a client/host drift is a compile error, not a runtime bug.
 */
function callCapabilitiesApi<M extends CapabilitiesApiMethod, T>(
  method: M,
  scope: CapabilitiesScope,
  payload: CapabilitiesApiRequests[M],
  signal?: AbortSignal,
): Promise<T> {
  return sharedCallCapabilitiesApi(method, scope, payload as Record<string, unknown>, signal)
}

/** Global (scope-less) wire call, typed by the shared request DTOs. */
function callCapabilitiesGlobalApi<M extends CapabilitiesApiMethod, T>(
  method: M,
  payload: CapabilitiesApiRequests[M],
  signal?: AbortSignal,
): Promise<T> {
  return sharedCallCapabilitiesGlobalApi(method, payload as Record<string, unknown>, signal)
}

export const sidebarApi = {
  fsRead: (
    scope: CapabilitiesScope,
    path: string,
    signal?: AbortSignal,
  ): Promise<CapabilitiesFsRead> => callCapabilitiesApi('fs.read', scope, { path }, signal),
  fsWrite: (
    scope: CapabilitiesScope,
    path: string,
    content: string,
  ): Promise<{ ok: boolean }> => callCapabilitiesApi('fs.write', scope, { path, content }),
  fsCreate: (
    scope: CapabilitiesScope,
    path: string,
    directory: boolean,
  ): Promise<{ ok: boolean }> => callCapabilitiesApi('fs.create', scope, { path, directory }),
  fsRename: (
    scope: CapabilitiesScope,
    from: string,
    to: string,
  ): Promise<{ ok: boolean }> => callCapabilitiesApi('fs.rename', scope, { from, to }),
  fsDelete: (
    scope: CapabilitiesScope,
    path: string,
  ): Promise<{ ok: boolean }> => callCapabilitiesApi('fs.delete', scope, { path }),
  fsCopy: (
    scope: CapabilitiesScope,
    from: string,
    to: string,
  ): Promise<{ ok: boolean }> => callCapabilitiesApi('fs.copy', scope, { from, to }),
  fsSearch: (
    scope: CapabilitiesScope,
    pattern: string,
    caseSensitive: boolean,
    signal?: AbortSignal,
  ): Promise<{
    hits: Array<{ path: string; line: number; text: string }>
    error: string | null
  }> => callCapabilitiesApi(
    'fs.search',
    scope,
    { pattern, caseSensitive },
    signal,
  ),
  // fsTail is a dormant wrapper — no surfaced consumer calls it yet.
  // Re-wiring a tail view re-enables it.
  fsTail: (
    scope: CapabilitiesScope,
    path: string,
    maxBytes?: number,
    signal?: AbortSignal,
  ): Promise<{ content: string; truncated: boolean }> => callCapabilitiesApi(
    'fs.tail',
    scope,
    { path, ...(maxBytes === undefined ? {} : { maxBytes }) },
    signal,
  ),
  fsTree: (
    scope: CapabilitiesScope,
    path: string,
    signal?: AbortSignal,
  ): Promise<CapabilitiesFsTree> => callCapabilitiesApi('fs.tree', scope, { path }, signal),
  gitBranch: (
    scope: CapabilitiesScope,
    signal?: AbortSignal,
  ): Promise<CapabilitiesGitBranch> => callCapabilitiesApi('git.branch', scope, {}, signal),
  gitUpstream: (
    scope: CapabilitiesScope,
    signal?: AbortSignal,
  ): Promise<CapabilitiesGitUpstreamStatus> => callCapabilitiesApi('git.upstream', scope, {}, signal),
  gitFetch: (scope: CapabilitiesScope): Promise<void> => callCapabilitiesApi('git.fetch', scope, {}),
  gitPull: (scope: CapabilitiesScope): Promise<void> => callCapabilitiesApi('git.pull', scope, {}),
  gitPush: (scope: CapabilitiesScope): Promise<void> => callCapabilitiesApi('git.push', scope, {}),
  gitForcePush: (scope: CapabilitiesScope): Promise<void> => callCapabilitiesApi('git.force-push', scope, {}),
  gitSync: (scope: CapabilitiesScope): Promise<void> => callCapabilitiesApi('git.sync', scope, {}),
  gitAbortMerge: (scope: CapabilitiesScope): Promise<void> => callCapabilitiesApi('git.abort-merge', scope, {}),
  gitAbortRebase: (scope: CapabilitiesScope): Promise<void> => callCapabilitiesApi('git.abort-rebase', scope, {}),
  gitGenerateCommitMessage: (
    scope: CapabilitiesScope,
  ): Promise<{ message: string }> => callCapabilitiesApi('git.generate-commit-message', scope, {}),
  gitCancelGenerateCommitMessage: (scope: CapabilitiesScope): Promise<void> => callCapabilitiesApi(
    'git.cancel-generate-commit-message',
    scope,
    {},
  ),
  // Source-Control-AI preferences intentionally have NO dedicated RPC: the
  // panel reads/writes the `source-control-ai` namespace through the same
  // generic settings.* seam as the sidebar prefs.
  sourceControlAiModels: (): Promise<CapabilitiesSourceControlAiModels> => callCapabilitiesGlobalApi(
    'source-control-ai.models',
    {},
  ),
  gitCheckout: (
    scope: CapabilitiesScope,
    branch: string,
  ): Promise<void> => callCapabilitiesApi('git.checkout', scope, { branch }),
  gitCommit: (
    scope: CapabilitiesScope,
    message: string,
  ): Promise<void> => callCapabilitiesApi('git.commit', scope, { message }),
  gitCommitDiff: (
    scope: CapabilitiesScope,
    hash: string,
    signal?: AbortSignal,
  ): Promise<{ diff: string }> => callCapabilitiesApi(
    'git.commit-diff',
    scope,
    { hash },
    signal,
  ),
  gitCommitFiles: (
    scope: CapabilitiesScope,
    hash: string,
    signal?: AbortSignal,
  ): Promise<CapabilitiesGitCommitFile[]> => callCapabilitiesApi(
    'git.commit-files',
    scope,
    { hash },
    signal,
  ),
  gitCommitFileDiff: (
    scope: CapabilitiesScope,
    hash: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<{ diff: string }> => callCapabilitiesApi(
    'git.commit-file-diff',
    scope,
    { hash, path },
    signal,
  ),
  gitCommittedFiles: (
    scope: CapabilitiesScope,
    signal?: AbortSignal,
  ): Promise<CapabilitiesGitCommitted> => callCapabilitiesApi(
    'git.committed-files',
    scope,
    {},
    signal,
  ),
  gitCommittedDiff: (
    scope: CapabilitiesScope,
    baseRef: string,
    path: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ diff: string }> => callCapabilitiesApi(
    'git.committed-diff',
    scope,
    { baseRef, ...(path === undefined ? {} : { path }) },
    signal,
  ),
  gitDiff: (
    scope: CapabilitiesScope,
    path: string | undefined,
    staged: boolean,
    signal?: AbortSignal,
    context?: number,
  ): Promise<{ diff: string }> => callCapabilitiesApi('git.diff', scope, {
    ...(path === undefined ? {} : { path }),
    staged,
    ...(context === undefined ? {} : { context }),
  }, signal),
  gitImageDiff: (
    scope: CapabilitiesScope,
    path: string,
    staged: boolean,
    signal?: AbortSignal,
  ): Promise<{ oldData: string; newData: string }> => callCapabilitiesApi('git.image-diff', scope, {
    path,
    staged,
  }, signal),
  gitLog: (
    scope: CapabilitiesScope,
    count = 30,
    skip = 0,
    signal?: AbortSignal,
  ): Promise<CapabilitiesGitLogEntry[]> => callCapabilitiesApi('git.log', scope, {
    count,
    skip,
  }, signal),
  gitStage: (
    scope: CapabilitiesScope,
    paths?: string | readonly string[],
  ): Promise<void> => callCapabilitiesApi('git.stage', scope, {
    ...(paths === undefined ? {} : { paths: toPathList(paths) }),
  }),
  gitUnstage: (
    scope: CapabilitiesScope,
    paths?: string | readonly string[],
  ): Promise<void> => callCapabilitiesApi('git.unstage', scope, {
    ...(paths === undefined ? {} : { paths: toPathList(paths) }),
  }),
  gitDiscard: (
    scope: CapabilitiesScope,
    paths: string | readonly string[],
  ): Promise<void> => callCapabilitiesApi('git.discard', scope, {
    paths: toPathList(paths),
  }),
  gitStatus: (
    scope: CapabilitiesScope,
    signal?: AbortSignal,
  ): Promise<CapabilitiesGitStatus> => callCapabilitiesApi('git.status', scope, {}, signal),
  workspaceFacts: (
    cwd: string,
    signal?: AbortSignal,
  ): Promise<CapabilitiesWorkspaceFacts> => callCapabilitiesGlobalApi(
    'workspace.facts',
    { cwd },
    signal,
  ),
  workspaceMutate: (
    cwd: string,
    mutation: CapabilitiesWorkspaceMutation,
  ): Promise<CapabilitiesWorkspaceMutationResponse> => callCapabilitiesGlobalApi(
    'workspace.mutate',
    { cwd, mutation },
  ),
  ptyClose: (
    scope: CapabilitiesScope,
    tab: string,
  ): Promise<{ ok: true }> => callCapabilitiesApi('pty.close', scope, {
    tab,
  }),
  ptyRetained: (
    scope: CapabilitiesScope,
    signal?: AbortSignal,
  ): Promise<{ sessions: Array<{
    tabId: string
    cwd: string
    incarnationId: string
    updatedAt: number
    historyBytes: number
  }> }> => callCapabilitiesApi('pty.retained', scope, {}, signal),
  ptyClearRetained: (
    scope: CapabilitiesScope,
    tab: string,
  ): Promise<{ ok: true }> => callCapabilitiesApi('pty.clear-retained', scope, { tab }),
  ptyRestart: (
    scope: CapabilitiesScope,
    tab: string,
    cols?: number,
    rows?: number,
  ): Promise<{ ok: true; incarnationId: string }> => callCapabilitiesApi('pty.restart', scope, {
    tab,
    ...(cols === undefined ? {} : { cols }),
    ...(rows === undefined ? {} : { rows }),
  }),
  settingsGet: (
    signal?: AbortSignal,
  ): Promise<CapabilitiesSettingsView> => callCapabilitiesGlobalApi(
    'settings.get',
    {},
    signal,
  ),
  settingsUpdate: (
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<CapabilitiesSettingsView> => callCapabilitiesGlobalApi('settings.update', {
    patch,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  }),
  jobOutput: (
    scope: CapabilitiesScope,
    id: string,
    signal?: AbortSignal,
  ): Promise<{ text: string; truncated: boolean; read: boolean }> => callCapabilitiesApi(
    'jobs.output',
    scope,
    { id },
    signal,
  ),
  jobKill: (
    scope: CapabilitiesScope,
    id: string,
    reason?: string,
  ): Promise<{ ok: true; outcome: 'requested' | 'already-finished' }> => {
    const payload: CapabilitiesApiRequests['jobs.kill'] = { id }
    if (reason !== undefined && reason !== '') payload.reason = reason
    return callCapabilitiesApi('jobs.kill', scope, payload)
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
  entries: readonly CapabilitiesGitStatusEntry[],
  stats?: readonly CapabilitiesGitStat[],
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
  listing: CapabilitiesFsTree,
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
  result: CapabilitiesFsRead,
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

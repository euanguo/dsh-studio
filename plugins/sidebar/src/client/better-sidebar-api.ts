import type {
  WorkspaceChange,
  WorkspaceFilesResponse,
} from '../protocol.ts'
import {
  callSidebarApi,
  callSidebarGlobalApi,
  type SidebarFsEntry,
  type SidebarFsRead,
  type SidebarFsTree,
  type SidebarGitBranch,
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
export type BetterSidebarScope = SidebarScope
export type BetterSidebarFsEntry = SidebarFsEntry
export type BetterSidebarFsTree = SidebarFsTree
export type BetterSidebarGitStatusEntry = SidebarGitStatusEntry
export type BetterSidebarGitStatus = SidebarGitStatus
export type BetterSidebarGitBranch = SidebarGitBranch
export type BetterSidebarGitLogEntry = SidebarGitLogEntry
export type BetterSidebarSettingsView = SidebarSettingsView
export type BetterSidebarFsRead = SidebarFsRead

export const betterSidebarApi = {
  fsRead: (
    scope: BetterSidebarScope,
    path: string,
    signal?: AbortSignal,
  ): Promise<BetterSidebarFsRead> => callSidebarApi('fs.read', scope, { path }, signal),
  fsWrite: (
    scope: BetterSidebarScope,
    path: string,
    content: string,
  ): Promise<{ ok: boolean }> => callSidebarApi('fs.write', scope, { path, content }),
  fsCreate: (
    scope: BetterSidebarScope,
    path: string,
    directory: boolean,
  ): Promise<{ ok: boolean }> => callSidebarApi('fs.create', scope, { path, directory }),
  fsRename: (
    scope: BetterSidebarScope,
    from: string,
    to: string,
  ): Promise<{ ok: boolean }> => callSidebarApi('fs.rename', scope, { from, to }),
  fsDelete: (
    scope: BetterSidebarScope,
    path: string,
  ): Promise<{ ok: boolean }> => callSidebarApi('fs.delete', scope, { path }),
  fsCopy: (
    scope: BetterSidebarScope,
    from: string,
    to: string,
  ): Promise<{ ok: boolean }> => callSidebarApi('fs.copy', scope, { from, to }),
  fsSearch: (
    scope: BetterSidebarScope,
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
    scope: BetterSidebarScope,
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
    scope: BetterSidebarScope,
    path: string,
    signal?: AbortSignal,
  ): Promise<BetterSidebarFsTree> => callSidebarApi('fs.tree', scope, { path }, signal),
  gitBranch: (
    scope: BetterSidebarScope,
    signal?: AbortSignal,
  ): Promise<BetterSidebarGitBranch> => callSidebarApi('git.branch', scope, {}, signal),
  gitCheckout: (
    scope: BetterSidebarScope,
    branch: string,
  ): Promise<{ ok: true }> => callSidebarApi('git.checkout', scope, { branch }),
  gitCommit: (
    scope: BetterSidebarScope,
    message: string,
  ): Promise<{ ok: true }> => callSidebarApi('git.commit', scope, { message }),
  gitCommitDiff: (
    scope: BetterSidebarScope,
    hash: string,
    signal?: AbortSignal,
  ): Promise<{ diff: string }> => callSidebarApi(
    'git.commit-diff',
    scope,
    { hash },
    signal,
  ),
  gitDiff: (
    scope: BetterSidebarScope,
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
    scope: BetterSidebarScope,
    path: string,
    staged: boolean,
    signal?: AbortSignal,
  ): Promise<{ oldData: string; newData: string }> => callSidebarApi('git.image-diff', scope, {
    path,
    staged,
  }, signal),
  gitLog: (
    scope: BetterSidebarScope,
    count = 30,
    skip = 0,
    signal?: AbortSignal,
  ): Promise<BetterSidebarGitLogEntry[]> => callSidebarApi('git.log', scope, {
    count,
    skip,
  }, signal),
  gitStage: (
    scope: BetterSidebarScope,
    path?: string,
  ): Promise<{ ok: true }> => callSidebarApi('git.stage', scope, {
    ...(path === undefined ? {} : { path }),
  }),
  gitUnstage: (
    scope: BetterSidebarScope,
    path?: string,
  ): Promise<{ ok: true }> => callSidebarApi('git.unstage', scope, {
    ...(path === undefined ? {} : { path }),
  }),
  gitDiscard: (
    scope: BetterSidebarScope,
    path?: string,
  ): Promise<{ ok: true }> => callSidebarApi('git.discard', scope, {
    ...(path === undefined ? {} : { path }),
  }),
  gitStatus: (
    scope: BetterSidebarScope,
    signal?: AbortSignal,
  ): Promise<BetterSidebarGitStatus> => callSidebarApi('git.status', scope, {}, signal),
  settingsGet: (
    signal?: AbortSignal,
  ): Promise<BetterSidebarSettingsView> => callSidebarGlobalApi(
    'settings.get',
    {},
    signal,
  ),
  settingsUpdate: (
    patch: Record<string, unknown>,
    expectedRevision?: number,
  ): Promise<BetterSidebarSettingsView> => callSidebarGlobalApi('settings.update', {
    patch,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  }),
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

export function workspaceChangesFromBetterSidebar(
  entries: readonly BetterSidebarGitStatusEntry[],
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

function workspaceParent(cwd: string, path: string): string | null {
  const root = normalizedPath(cwd)
  const current = normalizedPath(path)
  if (current === root || !current.startsWith(`${root}/`)) return null
  const parent = current.slice(0, current.lastIndexOf('/'))
  return parent.length >= root.length ? parent : null
}

export function mapBetterSidebarTree(
  cwd: string,
  listing: BetterSidebarFsTree,
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

export function mapBetterSidebarFile(
  cwd: string,
  path: string,
  result: BetterSidebarFsRead,
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

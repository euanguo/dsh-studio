/**
 * Shared sidebar JSON API wire contract (@oh-dsh/shared).
 *
 * Single source of truth for the sidebar API that BOTH halves consume: the
 * generic host (plugins/sidebar-host/src/index.ts) implements the
 * methods, and the client (better-sidebar-api.ts) calls them. The envelope
 * shape mirrors the upstream DSH-better-sidebar wire ({ok:true,value} /
 * {ok:false,error}); the client talks to the generic host's `/sidebar/api`
 * route directly.
 */

/**
 * One project-scoped request: the sidebar data model keys by the workspace
 * cwd (project dimension). `sessionId` has been dropped — fs/git/pty operate
 * on the project, not a conversation; the client resolves the authoritative
 * cwd from the active session before sending it.
 */
export interface SidebarScope {
  cwd: string
}

/** One explorer row (upstream fs-tree.ts SidebarFsEntry shape). */
export interface SidebarFsEntry {
  name: string
  path: string
  isDir: boolean
  hidden: boolean
}

/** One listed explorer level. */
export interface SidebarFsTree {
  path: string
  entries: SidebarFsEntry[]
  truncated: boolean
}

/** A bounded text read with binary detection (upstream readText contract). */
export type SidebarFsRead = {
  kind: 'text'
  content: string
  truncated: boolean
} | {
  kind: 'binary'
  head?: string
  size: number
  truncated: boolean
  /** Full base64 payload (≤ 2MB) for inline image/PDF previews. */
  data?: string
}

/** One `git status --porcelain=v1 -z` row. */
export interface SidebarGitStatusEntry {
  path: string
  /** Two-letter index/worktree status (X Y). */
  xy: string
}

/** Per-path `git diff --numstat` summary (aligned with `entries` order). */
export interface SidebarGitStat {
  path: string
  additions: number
  deletions: number
}

/** The source-control snapshot. */
export interface SidebarGitStatus {
  isRepo: boolean
  branch?: string
  entries: SidebarGitStatusEntry[]
  /** Optional per-entry +N/−M counts (missing entries mean 0/0). */
  stats?: SidebarGitStat[]
}

/** `git branch` snapshot. */
export interface SidebarGitBranch {
  current: string
  names: string[]
}

/** One `git log` row. */
export interface SidebarGitLogEntry {
  hash: string
  hashFull: string
  subject: string
  author: string
  date: string
  refs: string
}

/** One file touched by a commit (`git.commit-files`). */
export interface SidebarGitCommitFile {
  path: string
  /** Status letter (A/M/D/R/C/T). */
  status: string
  additions: number
  deletions: number
}

/** The committed-changes projection: files in local commits ahead of the
 *  branch upstream (`baseRef` null when there is no upstream to compare). */
export interface SidebarGitCommitted {
  baseRef: string | null
  entries: SidebarGitCommitFile[]
}

/** A raw unified diff string. */
export interface SidebarGitDiff {
  diff: string
}

/**
 * Workspace-level Git facts (repository identity + ahead/behind counts).
 * Unlike the session-scoped git.* methods, the workspace.* methods key on
 * a bare absolute cwd (the left rail / source-control panel operate on a
 * directory, not a conversation).
 */
export interface SidebarWorkspaceFacts {
  kind: 'directory' | 'repository'
  cwd: string
  root: string
  name: string
  ahead: number
  behind: number
  hasRemote: boolean
}

/**
 * One workspace-level mutation the host applies verbatim: branch creation
 * and push. The panel-local mutations (checkout / stage / commit) dispatch
 * through the session-scoped git.* methods instead.
 */
export type SidebarWorkspaceMutation =
  | { action: 'create-branch'; branch: string }
  | { action: 'push' }

/** Wire validation for one workspace mutation payload. */
export function isSidebarWorkspaceMutation(
  value: unknown,
): value is SidebarWorkspaceMutation {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  if (input.action === 'push') return true
  return input.action === 'create-branch' && typeof input.branch === 'string'
}

/** The workspace mutation result (human-readable message + fresh facts). */
export interface SidebarWorkspaceMutationResponse {
  message: string
  facts: SidebarWorkspaceFacts
}

/** The side card settings namespace view (value + revision). */
export interface SidebarSettingsView {
  revision?: number
  value?: unknown
}

/** Success/failure envelope of one API method. */
export interface SidebarEnvelope<T> {
  error?: { code?: string; message?: string }
  ok?: boolean
  value?: T
}

/**
 * Request DTOs per API method — the single source of truth for the wire
 * payload shapes. The host parses against these names and the client types
 * its calls with them, so the two halves cannot drift (the stage/unstage
 * `paths` vs `path` mismatch was exactly this class of bug).
 */
export interface SidebarApiRequests {
  'workspace.cwd': Record<string, never>
  'fs.tree': { path?: string }
  'fs.read': { path: string }
  'fs.write': { path: string; content: string }
  'fs.create': { path: string; directory?: boolean }
  'fs.rename': { from: string; to: string }
  'fs.delete': { path: string }
  'fs.copy': { from: string; to: string }
  'fs.search': { pattern: string; caseSensitive?: boolean }
  'fs.tail': { path: string; maxBytes?: number }
  'git.status': Record<string, never>
  'git.diff': { path?: string; staged?: boolean; context?: number }
  'git.image-diff': { path: string; staged?: boolean }
  'git.stage': { paths?: string[] }
  'git.unstage': { paths?: string[] }
  'git.commit': { message: string }
  'git.branch': Record<string, never>
  'git.checkout': { branch: string }
  'git.log': { count?: number; skip?: number }
  'git.commit-diff': { hash: string }
  'git.commit-files': { hash: string }
  'git.commit-file-diff': { hash: string; path: string }
  'git.committed-files': Record<string, never>
  'git.committed-diff': { baseRef: string; path?: string }
  'git.discard': { paths: string[] }
  'git.revert': { hash: string }
  'git.cherry-pick': { hash: string }
  'git.show': { path: string; rev: string }
  'git.worktree-list': Record<string, never>
  'git.worktree-add': { path: string; branch: string; createBranch?: boolean }
  'git.worktree-remove-preview': { path: string }
  'git.worktree-remove': { path: string; force?: boolean }
  'project.icon-detect': { cwd: string }
  'workspace.facts': { cwd: string }
  'workspace.mutate': { cwd: string; mutation: SidebarWorkspaceMutation }
  'pty.close': { tab: string }
  'pty.retained': Record<string, never>
  'pty.clear-retained': { tab: string }
  'pty.restart': { tab: string; cols?: number; rows?: number }
  'agent-pty.close': { uuid: string }
  'settings.get': { ns?: string }
  'settings.update': { ns?: string; patch: Record<string, unknown>; expectedRevision?: number }
  /** Wholesale replace of one namespace's user section (deletion-capable). */
  'settings.replace': { ns?: string; section: Record<string, unknown>; expectedRevision?: number }
  /** Path-addressed set/unset edits on one namespace (deletion-capable). */
  'settings.mutate': {
    ns?: string
    ops: ReadonlyArray<{ op: 'set' | 'unset'; path: string[]; value?: unknown }>
    expectedRevision?: number
  }
  'browser.probe': { url: string }
  'jobs.output': { id: string }
  'jobs.kill': { id: string; reason?: string }
}

export type SidebarApiMethod = keyof SidebarApiRequests

/** Route prefix served by the generic sidebar host (`/sidebar/api`). */
export const SIDEBAR_API_BASE = '/sidebar/api'

/** Build the POST body for one scoped method call (the project cwd). */
export function sidebarScopePayload(
  scope: SidebarScope,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    cwd: scope.cwd,
    ...extra,
  }
}

/** POST one scoped API method and unwrap the envelope (client side). */
export async function callSidebarApi<T>(
  method: string,
  scope: SidebarScope,
  extra: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${SIDEBAR_API_BASE}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(sidebarScopePayload(scope, extra)),
    ...(signal === undefined ? {} : { signal }),
  })
  const envelope = await response.json() as SidebarEnvelope<T>
  // Void methods (git.stage / git.unstage / git.discard / git.checkout /
  // git.commit) legitimately return `{ok:true}` with no `value` — JSON drops
  // the undefined field — so success is judged by `ok === true` alone, never
  // by the presence of `value`. Requiring `value !== undefined` made every
  // void mutation "fail" with `HTTP 200`, flashing the error bar and skipping
  // the post-mutation refresh (the "slow stage/unstage + red flash" bug).
  if (!response.ok || envelope.ok !== true) {
    throw new Error(envelope.error?.message ?? `HTTP ${String(response.status)}`)
  }
  // On success `value` is present for value methods and absent (undefined) for
  // void methods — the caller's `T` encodes which, so the cast is sound.
  return envelope.value as T
}

/** POST one global (scope-less) API method and unwrap the envelope. */
export async function callSidebarGlobalApi<T>(
  method: string,
  extra: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${SIDEBAR_API_BASE}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(extra),
    ...(signal === undefined ? {} : { signal }),
  })
  const envelope = await response.json() as SidebarEnvelope<T>
  if (!response.ok || envelope.ok !== true) {
    throw new Error(envelope.error?.message ?? `HTTP ${String(response.status)}`)
  }
  // On success `value` is present for value methods and absent (undefined) for
  // void methods — the caller's `T` encodes which, so the cast is sound.
  return envelope.value as T
}

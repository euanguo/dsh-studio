/**
 * Shared sidebar JSON API wire contract (@oh-dsh/shared).
 *
 * Single source of truth for the desktop sidebar API that BOTH halves
 * consume: the desktop host (plugins/desktop-sidebar/src/sidebar-api.ts)
 * implements the methods, and the client (better-sidebar-api.ts) calls them.
 * The envelope shape mirrors the upstream DSH-better-sidebar wire
 * ({ok:true,value} / {ok:false,error}) so the same protocol stays
 * interchangeable, but the desktop client never depends on the upstream
 * host's route directly — it only talks to /oh-dsh-desktop/sidebar/api.
 */

/** One conversation-scoped request: the owning session + its cwd. */
export interface SidebarScope {
  sessionId: string
  cwd?: string
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

/** A raw unified diff string. */
export interface SidebarGitDiff {
  diff: string
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

/** Route prefix served by the desktop host (NOT the upstream /sidebar/api). */
export const SIDEBAR_API_BASE = '/oh-dsh-desktop/sidebar/api'

/** Build the POST body for one scoped method call. */
export function sidebarScopePayload(
  scope: SidebarScope,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    sessionId: scope.sessionId,
    ...(scope.cwd === undefined || scope.cwd === '' ? {} : { cwd: scope.cwd }),
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
  if (!response.ok || envelope.ok !== true || envelope.value === undefined) {
    throw new Error(envelope.error?.message ?? `HTTP ${String(response.status)}`)
  }
  return envelope.value
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
  if (!response.ok || envelope.ok !== true || envelope.value === undefined) {
    throw new Error(envelope.error?.message ?? `HTTP ${String(response.status)}`)
  }
  return envelope.value
}

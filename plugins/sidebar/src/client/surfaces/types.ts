/**
 * Center surface identity types (ported from the reference project's
 * `surfaces/types.ts`).
 *
 * A surface id is a parseable canonical string — the single identity fact
 * source for the open-set. Surfaces store identity + minimal visual state
 * (`isPreview`) only; never business data.
 */
import { basename } from '@dsh-studio/shared/path'

export type CenterSurfaceKind =
  | 'conversation'
  | 'file'
  | 'diff'
  | 'diff-all'
  | 'commit'
  | 'commit-file'
  | 'committed'
  | 'conflict'
  | 'browser'
  | 'terminal'

export interface ConversationCenterSurface {
  id: string
  kind: 'conversation'
  sessionId: string
  cwd: string
  title: string
  closable: true
  isPreview: false
}

export interface FileCenterSurface {
  id: string
  kind: 'file'
  /** The workspace (cwd) this surface belongs to — tabs persist per cwd. */
  cwd: string
  filePath: string
  title: string
  closable: true
  isPreview: boolean
  /** Persisted Markdown Source/Preview preference for this tab. */
  markdownPreview?: boolean
}

export interface DiffCenterSurface {
  id: string
  kind: 'diff'
  cwd: string
  filePath: string
  staged: boolean
  title: string
  closable: true
  isPreview: boolean
}

/** Combined diff of one change area (staged / unstaged) — the section's
 *  "view all" target. */
export interface DiffAllCenterSurface {
  id: string
  kind: 'diff-all'
  cwd: string
  staged: boolean
  title: string
  closable: true
  isPreview: boolean
}

export interface CommitCenterSurface {
  id: string
  kind: 'commit'
  cwd: string
  /** The full commit hash this surface shows the diff of. */
  hash: string
  title: string
  closable: true
  isPreview: boolean
}

/** Single-file diff within one commit (a file clicked in a commit's inline
 *  file list). */
export interface CommitFileCenterSurface {
  id: string
  kind: 'commit-file'
  cwd: string
  hash: string
  filePath: string
  title: string
  closable: true
  isPreview: boolean
}

/** Committed-changes diff against the branch upstream: the whole projection
 *  (`filePath` unset) or one committed file. */
export interface CommittedCenterSurface {
  id: string
  kind: 'committed'
  cwd: string
  baseRef: string
  filePath?: string
  title: string
  closable: true
  isPreview: boolean
}

/** Merge-conflict resolver for one conflicted file (git UU/AA/DD entry). */
export interface ConflictCenterSurface {
  id: string
  kind: 'conflict'
  cwd: string
  filePath: string
  title: string
  closable: true
  isPreview: boolean
}

export interface BrowserCenterSurface {
  id: string
  kind: 'browser'
  /** The workspace (cwd) this surface belongs to — tabs persist per cwd. */
  cwd: string
  title: string
  resource?: string
  closable: true
  isPreview: boolean
}

export interface TerminalCenterSurface {
  id: string
  kind: 'terminal'
  /** The workspace (cwd) this surface belongs to — tabs persist per cwd. */
  cwd: string
  title: string
  closable: true
  isPreview: false
}

export type CenterSurface =
  | ConversationCenterSurface
  | FileCenterSurface
  | DiffCenterSurface
  | DiffAllCenterSurface
  | CommitCenterSurface
  | CommitFileCenterSurface
  | CommittedCenterSurface
  | ConflictCenterSurface
  | BrowserCenterSurface
  | TerminalCenterSurface

export type CenterSurfaceSlice = Readonly<{
  open: ReadonlyArray<CenterSurface>
  activeId: string | null
}>

/* ---------- id helpers (canonical, parseable) ---------- */

/** Prefix of conversation surface ids (`conversation:<sessionId>`). */
export const CONVERSATION_SURFACE_PREFIX = 'conversation:'

export function conversationSurfaceId(sessionId: string): string {
  return `${CONVERSATION_SURFACE_PREFIX}${sessionId}`
}

export function fileSurfaceId(filePath: string): string {
  return `file:${filePath}`
}

export function diffSurfaceId(filePath: string, staged: boolean): string {
  return `diff:${staged ? 'staged' : 'unstaged'}:${filePath}`
}

export function diffAllSurfaceId(staged: boolean): string {
  return `diff-all:${staged ? 'staged' : 'unstaged'}`
}

export function commitSurfaceId(hash: string): string {
  return `commit:${hash}`
}

export function commitFileSurfaceId(hash: string, filePath: string): string {
  return `commit-file:${hash}:${filePath}`
}

export function committedSurfaceId(baseRef: string, filePath?: string): string {
  return `committed:${baseRef}:${filePath ?? 'all'}`
}

export function conflictSurfaceId(filePath: string): string {
  return `conflict:${filePath}`
}

export function browserSurfaceId(resource: string | undefined): string {
  return `browser:${resource ?? 'blank'}`
}

/** Prefix of terminal surface ids (`terminal:<n>` — one instance per tab).
 *  Every terminal tab owns an independent pty (the id doubles as the host's
 *  `tab` parameter on `/sidebar/ws/terminal`). */
export const TERMINAL_SURFACE_PREFIX = 'terminal:'

export function terminalSurfaceId(instance: number): string {
  return `${TERMINAL_SURFACE_PREFIX}${instance}`
}

/** The highest terminal instance number already open in a slice (0 when
 *  none) — the next freshly opened terminal takes max+1. */
export function maxTerminalInstance(open: ReadonlyArray<CenterSurface>): number {
  let max = 0
  for (const surface of open) {
    if (surface.kind !== 'terminal') continue
    const match = new RegExp(`^${TERMINAL_SURFACE_PREFIX}(\\d+)$`).exec(surface.id)
    if (match !== null) max = Math.max(max, Number(match[1]))
  }
  return max
}

/* ---------- selectors ---------- */

export function isPreviewSurface(surface: CenterSurface): boolean {
  return (surface.kind === 'file' || surface.kind === 'diff' || surface.kind === 'diff-all' || surface.kind === 'commit' || surface.kind === 'commit-file' || surface.kind === 'committed' || surface.kind === 'conflict' || surface.kind === 'browser')
    && surface.isPreview
}

export function resolveActiveSurface(slice: CenterSurfaceSlice): CenterSurface | null {
  if (slice.activeId === null) return null
  return slice.open.find(surface => surface.id === slice.activeId) ?? null
}

export function fileNameFromPath(filePath: string): string {
  return basename(filePath)
}

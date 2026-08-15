/**
 * Center surface identity types (ported from the reference project's
 * `surfaces/types.ts`).
 *
 * A surface id is a parseable canonical string — the single identity fact
 * source for the open-set. Surfaces store identity + minimal visual state
 * (`isPreview`) only; never business data.
 */

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
  | 'editor'

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
  sessionId: string
  cwd: string
  filePath: string
  title: string
  closable: true
  isPreview: boolean
  /** Persisted Markdown Source/Preview preference for this tab. */
  markdownPreview?: boolean
}

export interface EditorCenterSurface {
  id: string
  kind: 'editor'
  sessionId: string
  cwd: string
  filePath: string
  title: string
  closable: true
  isPreview: false
}

export interface DiffCenterSurface {
  id: string
  kind: 'diff'
  sessionId: string
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
  sessionId: string
  cwd: string
  staged: boolean
  title: string
  closable: true
  isPreview: boolean
}

export interface CommitCenterSurface {
  id: string
  kind: 'commit'
  sessionId: string
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
  sessionId: string
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
  sessionId: string
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
  sessionId: string
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
  | EditorCenterSurface
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

export function conversationSurfaceId(sessionId: string): string {
  return `conversation:${sessionId}`
}

export function fileSurfaceId(filePath: string): string {
  return `file:${filePath}`
}

export function editorSurfaceId(filePath: string): string {
  return `editor:${filePath}`
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

export function terminalSurfaceId(): string {
  return 'terminal'
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
  return filePath.split(/[/\\]/).filter(Boolean).at(-1) || filePath
}

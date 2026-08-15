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
  sessionId: string
  cwd: string
  filePath: string
  title: string
  closable: true
  isPreview: boolean
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

export function diffSurfaceId(filePath: string, staged: boolean): string {
  return `diff:${staged ? 'staged' : 'unstaged'}:${filePath}`
}

export function browserSurfaceId(resource: string | undefined): string {
  return `browser:${resource ?? 'blank'}`
}

export function terminalSurfaceId(): string {
  return 'terminal'
}

/* ---------- selectors ---------- */

export function isPreviewSurface(surface: CenterSurface): boolean {
  return (surface.kind === 'file' || surface.kind === 'diff' || surface.kind === 'browser')
    && surface.isPreview
}

export function resolveActiveSurface(slice: CenterSurfaceSlice): CenterSurface | null {
  if (slice.activeId === null) return null
  return slice.open.find(surface => surface.id === slice.activeId) ?? null
}

export function fileNameFromPath(filePath: string): string {
  return filePath.split(/[/\\]/).filter(Boolean).at(-1) || filePath
}

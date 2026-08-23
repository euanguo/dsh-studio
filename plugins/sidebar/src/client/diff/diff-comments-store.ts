/**
 * Unified workbench comment store (R1): one persisted batch for file-view
 * AND diff annotations (worktree scope), replacing the v1 line-only shape.
 *
 * v2 schema (`dsh-studio.sidebar.diff-comments.v2`) with an IDEMPOTENT v1
 * migration (the legacy blob is left untouched as an audit trail; reruns
 * rewrite v2 from the same source, so no duplicates). Anchors are
 * path + line RANGE plus an optional content hash for drift/outdated
 * detection. Comments carry the resolve lifecycle (like review comments)
 * and an optional branch stamp for cross-branch filtering.
 *
 * The zustand store is the single live mirror — surfaces subscribe instead
 * of keeping local copies, and every mutation writes through.
 */
import { create } from 'zustand'

export interface WorkbenchComment {
  id: string
  /** Absolute path (Electron surface) or git-relative (diff surface). */
  path: string
  /** 1-based anchor line — the range start. */
  startLine: number
  /** Range end when the comment spans multiple lines (defaults to start). */
  endLine?: number
  /** Anchor-line content hash ⇒ drift/outdated detection. */
  contentHash?: string
  /** Branch stamp on write; legacy null stays visible across branches. */
  branch?: string | null
  body: string
  createdAt: string
  /** Resolution timestamp; resolved comments stay listed but are excluded
   *  from new "add to conversation" payloads. */
  resolvedAt?: string
}

const KEY = 'dsh-studio.sidebar.diff-comments.v2'
const LEGACY_KEY = 'dsh-studio.sidebar.diff-comments.v1'
const MAX_COMMENTS = 200

function isLegacyComment(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string'
    && typeof entry.filePath === 'string'
    && Number.isInteger(entry.line)
    && typeof entry.body === 'string'
    && typeof entry.createdAt === 'string'
}

function isWorkbenchComment(value: unknown): value is WorkbenchComment {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string'
    && typeof entry.path === 'string'
    && Number.isInteger(entry.startLine)
    && typeof entry.body === 'string'
    && typeof entry.createdAt === 'string'
}

/** Read v2; falls back to a one-time idempotent migration from v1. */
export function readWorkbenchComments(): WorkbenchComment[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isWorkbenchComment).slice(-MAX_COMMENTS)
    }
  } catch {
    // Fall through to the migration path below.
  }
  return migrateLegacyComments()
}

function migrateLegacyComments(): WorkbenchComment[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const migrated: WorkbenchComment[] = parsed
      .filter(isLegacyComment)
      .map(entry => {
        const item = entry as { id: string; filePath: string; line: number; body: string; createdAt: string }
        return {
          id: item.id,
          path: item.filePath,
          startLine: item.line,
          body: item.body,
          createdAt: item.createdAt,
        }
      })
      .slice(-MAX_COMMENTS)
    if (migrated.length > 0) writeWorkbenchComments(migrated)
    return migrated
  } catch {
    return []
  }
}

export function writeWorkbenchComments(comments: readonly WorkbenchComment[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(comments.slice(-MAX_COMMENTS)))
  } catch {
    // Best effort.
  }
}

export function nextWorkbenchCommentId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `comment-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
}

interface WorkbenchCommentState {
  comments: readonly WorkbenchComment[]
  /** The single write path: surfaces never persist directly. */
  addComment(comment: WorkbenchComment): void
  removeComment(id: string): void
  /** Mark resolved (kept + listed, excluded from new payloads). */
  resolveComment(id: string): void
  /** Re-open a resolved comment. */
  unresolveComment(id: string): void
}

/** Live mirror of the persisted comments; surfaces subscribe to this. */
export const useDiffCommentsStore = create<WorkbenchCommentState>((set, get) => ({
  comments: readWorkbenchComments(),
  addComment: comment => {
    const next = [...get().comments, comment]
    set({ comments: next })
    writeWorkbenchComments(next)
  },
  removeComment: id => {
    const next = get().comments.filter(comment => comment.id !== id)
    set({ comments: next })
    writeWorkbenchComments(next)
  },
  resolveComment: id => {
    const next = get().comments.map(comment =>
      comment.id === id && comment.resolvedAt === undefined
        ? { ...comment, resolvedAt: new Date().toISOString() }
        : comment,
    )
    if (next !== get().comments) {
      set({ comments: next })
      writeWorkbenchComments(next)
    }
  },
  unresolveComment: id => {
    const next = get().comments.map(comment => {
      if (comment.id !== id || comment.resolvedAt === undefined) return comment
      const reopened = { ...comment }
      delete reopened.resolvedAt
      return reopened
    })
    if (next !== get().comments) {
      set({ comments: next })
      writeWorkbenchComments(next)
    }
  },
}))

/** Strip the workspace root prefix so git-relative and absolute paths compare. */
export function pathRelativeToCwd(filePath: string, cwd: string): string {
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
}

/**
 * Whether a stored comment path (git-relative, from the diff surface) refers
 * to the same file as a surface's `filePath` (absolute in Electron). Both
 * sides are normalized against the workspace cwd before comparing.
 */
export function commentPathMatches(storedPath: string, filePath: string, cwd: string): boolean {
  return pathRelativeToCwd(storedPath, cwd) === pathRelativeToCwd(filePath, cwd)
}

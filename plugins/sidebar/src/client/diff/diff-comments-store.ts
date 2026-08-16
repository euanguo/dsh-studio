/**
 * Persisted diff comments (worktree diff scope), stored per workspace
 * +cwd+file+staged in localStorage. The zustand store is the single live
 * mirror — surfaces subscribe instead of keeping local copies (M5), and
 * every mutation writes through to the localStorage persistence layer.
 */
import { create } from 'zustand'

export interface DiffComment {
  id: string
  filePath: string
  line: number
  body: string
  createdAt: string
}

const KEY = 'oh-dsh.sidebar.diff-comments.v1'

export function readDiffComments(): DiffComment[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (value): value is DiffComment =>
        typeof value === 'object' && value !== null
        && typeof (value as DiffComment).id === 'string'
        && typeof (value as DiffComment).filePath === 'string'
        && Number.isInteger((value as DiffComment).line)
        && typeof (value as DiffComment).body === 'string'
        && typeof (value as DiffComment).createdAt === 'string',
    )
  } catch {
    return []
  }
}

export function writeDiffComments(comments: readonly DiffComment[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(comments.slice(-200)))
  } catch {
    // Best effort.
  }
}

export function nextDiffCommentId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `diff-comment-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`
}

interface DiffCommentsState {
  comments: readonly DiffComment[]
  addComment(comment: DiffComment): void
  removeComment(id: string): void
}

/** Live mirror of the persisted comments; surfaces subscribe to this. */
export const useDiffCommentsStore = create<DiffCommentsState>((set, get) => ({
  comments: readDiffComments(),
  addComment: comment => {
    const next = [...get().comments, comment]
    set({ comments: next })
    writeDiffComments(next)
  },
  removeComment: id => {
    const next = get().comments.filter(comment => comment.id !== id)
    set({ comments: next })
    writeDiffComments(next)
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

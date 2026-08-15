/**
 * Minimal persisted diff comments (worktree diff scope).
 * Stored per workspace+cwd+file+staged in localStorage; pure model.
 */
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

/**
 * Git review diff parsing and its structural types (moved out of review/:
 * the diff layer needs these to build DiffDocuments, and review/ consumed
 * them back — the cross-import cycle is broken by owning the git-diff
 * parsing in diff/).
 */
import type { BetterSidebarGitLogEntry } from '../better-sidebar-api.ts'
import type { DiffDocument } from './file-diff.ts'

export type GitReviewLineType = 'context' | 'addition' | 'deletion'

export interface GitReviewLine {
  key: string
  type: GitReviewLineType
  content: string
  oldLine: number | null
  newLine: number | null
}

export type GitReviewFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'binary'

export interface GitReviewFile {
  path: string
  oldPath: string | null
  status: GitReviewFileStatus
  additions: number
  deletions: number
  lines: GitReviewLine[]
}

export interface GitReviewCommitSummary {
  id: string
  shortId: string
  subject: string
  author: string
  authoredAt: string
}

export interface GitReviewCommit extends GitReviewCommitSummary {
  message: string
  files: GitReviewFile[]
}

/** Per-file line cap when converting review files to diff documents. */
const MAX_REVIEW_DIFF_LINES = 400

interface MutableReviewFile extends GitReviewFile {
  oldCursor: number | null
  newCursor: number | null
}

function fileStatus(line: string): GitReviewFileStatus | null {
  if (line.startsWith('new file mode ')) return 'added'
  if (line.startsWith('deleted file mode ')) return 'deleted'
  if (line.startsWith('rename from ')) return 'renamed'
  if (line.startsWith('Binary files ')) return 'binary'
  return null
}

function hunkStart(line: string): { oldStart: number; newStart: number } | null {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
  if (match === null) return null
  const oldStart = Number(match[1])
  const newStart = Number(match[2])
  if (!Number.isSafeInteger(oldStart) || !Number.isSafeInteger(newStart)) {
    return null
  }
  return { oldStart, newStart }
}

function addLine(
  file: MutableReviewFile,
  type: GitReviewLineType,
  content: string,
): void {
  const oldLine = type === 'addition' ? null : file.oldCursor
  const newLine = type === 'deletion' ? null : file.newCursor
  file.lines.push({
    key: `${file.path}:${oldLine ?? 'x'}:${newLine ?? 'x'}:${String(file.lines.length)}`,
    type,
    content,
    oldLine,
    newLine,
  })
  if (type !== 'addition' && file.oldCursor !== null) file.oldCursor += 1
  if (type !== 'deletion' && file.newCursor !== null) file.newCursor += 1
  if (type === 'addition') file.additions += 1
  if (type === 'deletion') file.deletions += 1
}

export function parseGitReviewDiff(output: string): GitReviewFile[] {
  const files: GitReviewFile[] = []
  let current: MutableReviewFile | null = null
  let inHunk = false

  const finish = (): void => {
    if (current === null) return
    const { oldCursor: _oldCursor, newCursor: _newCursor, ...file } = current
    files.push(file)
    current = null
    inHunk = false
  }

  for (const rawLine of output.split(/\r?\n/)) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(rawLine)
    if (header !== null) {
      finish()
      current = {
        path: header[2] ?? header[1] ?? 'unknown',
        oldPath: header[1] ?? null,
        status: 'modified',
        additions: 0,
        deletions: 0,
        lines: [],
        oldCursor: null,
        newCursor: null,
      }
      continue
    }
    if (current === null) continue

    const status = fileStatus(rawLine)
    if (status !== null) {
      current.status = status
      continue
    }
    if (rawLine.startsWith('rename to ')) {
      current.path = rawLine.slice('rename to '.length)
      current.status = 'renamed'
      continue
    }
    if (rawLine.startsWith('--- ')) {
      const path = rawLine.slice(4)
      if (path !== '/dev/null') {
        current.oldPath = path.startsWith('a/') ? path.slice(2) : path
      }
      continue
    }
    if (rawLine.startsWith('+++ ')) {
      const path = rawLine.slice(4)
      if (path !== '/dev/null') {
        current.path = path.startsWith('b/') ? path.slice(2) : path
      }
      continue
    }

    const hunk = hunkStart(rawLine)
    if (hunk !== null) {
      current.oldCursor = hunk.oldStart
      current.newCursor = hunk.newStart
      inHunk = true
      continue
    }
    if (!inHunk || rawLine.startsWith('\\ No newline at end of file')) {
      continue
    }
    if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) {
      addLine(current, 'addition', rawLine.slice(1))
    } else if (rawLine.startsWith('-') && !rawLine.startsWith('---')) {
      addLine(current, 'deletion', rawLine.slice(1))
    } else if (rawLine.startsWith(' ')) {
      addLine(current, 'context', rawLine.slice(1))
    }
  }
  finish()
  return files
}

export function reviewCommitFromBetterSidebar(
  entry: BetterSidebarGitLogEntry,
  diff: string,
): GitReviewCommit {
  return {
    id: entry.hashFull,
    shortId: entry.hash,
    subject: entry.subject,
    author: entry.author,
    authoredAt: entry.date,
    message: entry.subject,
    files: parseGitReviewDiff(diff),
  }
}

/** GitReviewFile (commit review) → the unified DiffDocument shape. */
export function reviewFileToDiffDocument(file: GitReviewFile): DiffDocument {
  const truncated = file.lines.length > MAX_REVIEW_DIFF_LINES
  return {
    path: file.path,
    change: file.status === 'added' ? 'added'
      : file.status === 'deleted' ? 'deleted'
      : file.status === 'renamed' ? 'renamed'
      : 'modified',
    additions: file.additions,
    deletions: file.deletions,
    truncated,
    lines: file.lines.slice(0, MAX_REVIEW_DIFF_LINES).map(line => {
      const kind = line.type === 'addition' ? 'added'
        : line.type === 'deletion' ? 'removed'
        : 'context'
      return {
        kind,
        text: line.content,
        displayText: line.content === '' ? ' ' : line.content,
        oldLine: line.oldLine,
        newLine: line.newLine,
        oldLineLabel: line.oldLine === null ? ' ' : String(line.oldLine),
        newLineLabel: line.newLine === null ? ' ' : String(line.newLine),
      }
    }),
  }
}

/**
 * Comment-rails PURE logic (no JSX, no DOM): anchor matching and the
 * lightweight "reference in chat" payload. Kept importable by `node --test`
 * (plain .ts) so the decision table is unit-tested directly.
 */
import type { WorkbenchComment } from '../diff/diff-comments-store.ts'
import { commentPathMatches } from '../diff/diff-comments-store.ts'

/** Whether a comment's anchor covers `line` in `path` (cwd-normalized). */
export function commentCoversLine(
  comment: WorkbenchComment,
  path: string,
  cwd: string,
  line: number,
): boolean {
  if (!commentPathMatches(comment.path, path, cwd)) return false
  return line >= comment.startLine && line <= (comment.endLine ?? comment.startLine)
}

/** The lightweight "reference in chat" payload (`path` L{line}: body). */
export function buildCommentReference(path: string, line: number, body: string): string {
  const trimmed = body.trim()
  return trimmed === ''
    ? '`' + path + '` L' + String(line)
    : '`' + path + '` L' + String(line) + ': ' + trimmed
}

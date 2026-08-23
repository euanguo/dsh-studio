/**
 * Shared line-comment bubble for Pierre annotation rows. One component serves
 * all three comment surfaces: FileDiff (diff view), File (file viewer) and
 * the editor's File — the surrounding annotation row is provided by Pierre's
 * core CSS; this card is the only custom chrome.
 */
import type { WorkbenchComment } from './diff-comments-store.ts'

export function CommentBubble({ comment }: { comment: WorkbenchComment }): JSX.Element {
  return (
    <div
      className="dsh-studio-line-comment"
      data-comment-id={comment.id}
      data-resolved={comment.resolvedAt !== undefined || undefined}
      title={comment.body}
    >
      <span className="dsh-studio-line-comment-body">{comment.body}</span>
    </div>
  )
}

/**
 * Shared line-comment bubble for Pierre annotation rows. One component serves
 * all three comment surfaces: FileDiff (diff view), File (file viewer) and
 * the editor's File — the surrounding annotation row is provided by Pierre's
 * core CSS; this card is the only custom chrome.
 */
import type { DiffComment } from './diff-comments-store.ts'

export function CommentBubble({ comment }: { comment: DiffComment }): JSX.Element {
  return (
    <div className="oh-dsh-line-comment" data-comment-id={comment.id} title={comment.body}>
      <span className="oh-dsh-line-comment-body">{comment.body}</span>
    </div>
  )
}

/**
 * Shared line-comment bubble for Pierre annotation rows. One component serves
 * all three comment surfaces: FileDiff (diff view), File (file viewer) and
 * the editor's File — the surrounding annotation row is provided by Pierre's
 * core CSS; this card is the only custom chrome.
 *
 * Optional row actions (delete / resolve / unresolve) render on hover; they
 * are wired by the surface that mounts the annotation, so the bubble stays
 * presentational. Actions use the official `ToolbarAction` (project chrome:
 * ghost icon-only seat, tooltip + accessible name, skin-rounded corners).
 */
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import type { WorkbenchComment } from './diff-comments-store.ts'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import { ToolbarAction } from '@dsh-studio/shared/ui'
import { IconCheck, IconTrash } from '@dsh-studio/shared/tabler-icons'

export interface CommentBubbleProps {
  comment: WorkbenchComment
  onResolve?(id: string): void
  onUnresolve?(id: string): void
  onRemove?(id: string): void
  t: Translate<WorkspaceMessage>
}

export function CommentBubble({
  comment,
  onResolve,
  onUnresolve,
  onRemove,
  t,
}: CommentBubbleProps): JSX.Element {
  const resolved = comment.resolvedAt !== undefined
  return (
    <div
      className="dsh-studio-line-comment"
      data-comment-id={comment.id}
      data-resolved={resolved || undefined}
      title={comment.body}
    >
      <span className={surfaceCss["dsh-studio-line-comment-body"]}>{comment.body}</span>
      {(onResolve !== undefined || onRemove !== undefined) ? (
        <span className={surfaceCss["dsh-studio-line-comment-actions"]} role="group" aria-label={t('diff.comment-actions')}>
          {onResolve !== undefined && !resolved ? (
            <ToolbarAction
              variant="ghost"
              icon={<IconCheck aria-hidden="true" />}
              label={t('diff.comment-resolve')}
              tooltipSide="top"
              className={surfaceCss["dsh-studio-line-comment-action"]}
              onClick={event => { event.stopPropagation(); onResolve(comment.id) }}
            />
          ) : null}
          {onUnresolve !== undefined && resolved ? (
            <ToolbarAction
              variant="ghost"
              icon={<IconCheck aria-hidden="true" />}
              label={t('diff.comment-reopen')}
              tooltipSide="top"
              className={surfaceCss["dsh-studio-line-comment-action"]}
              onClick={event => { event.stopPropagation(); onUnresolve(comment.id) }}
            />
          ) : null}
          {onRemove !== undefined ? (
            <ToolbarAction
              variant="ghost"
              icon={<IconTrash aria-hidden="true" />}
              label={t('diff.comment-delete')}
              tooltipSide="top"
              className={`${surfaceCss["dsh-studio-line-comment-action"]} ${surfaceCss["dsh-studio-line-comment-action-danger"]}`}
              onClick={event => { event.stopPropagation(); onRemove(comment.id) }}
            />
          ) : null}
        </span>
      ) : null}
    </div>
  )
}
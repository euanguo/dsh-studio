/**
 * The full comment compose card (replaces the rails' bare single-line
 * composer). One card family for every "add/resolve a line comment" entry:
 * the gutter "+" (hover rails) and the selection action bar's Comment
 * button both open this card, so comment UX is identical everywhere.
 *
 * Card anatomy (mirrors the reference workbench's diff comment card):
 *  - header: the anchor label ("Comment on line 12" / "... lines 12-15");
 *  - a resizable textarea;
 *  - actions: Comment (primary, commits), Reference in chat (secondary,
 *    lightweight composer injection), Delete (only when editing an
 *    existing comment), Cancel.
 * Keys: Enter commits, Shift+Enter inserts a newline, Esc dismisses.
 */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'

export interface CommentComposeCardProps {
  /** Header label, e.g. "Comment on line 12–15". */
  lineLabel: string
  placeholder: string
  submitLabel?: string
  initialBody?: string
  /** Show the destructive Delete exit (editing an existing comment). */
  canDelete?: boolean
  onCommit(body: string): void
  /** Lightweight composer reference exit; hidden when absent. */
  onReference?(body: string): void
  onCancel(): void
  onDelete?(): void
  t: Translate<WorkspaceMessage>
}

export function CommentComposeCard({
  lineLabel,
  placeholder,
  submitLabel,
  initialBody = '',
  canDelete = false,
  onCommit,
  onReference,
  onCancel,
  onDelete,
  t,
}: CommentComposeCardProps): JSX.Element {
  const [body, setBody] = useState(initialBody)
  const empty = body.trim() === ''

  const commit = (): void => {
    const trimmed = body.trim()
    if (trimmed === '') return
    onCommit(trimmed)
  }

  return (
    <div
      className="dsh-studio-comment-compose"
      role="dialog"
      aria-label={lineLabel}
      data-viewport-safe="true"
      onMouseDown={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
    >
      <div className="dsh-studio-comment-compose-head">{lineLabel}</div>
      <textarea
        className="dsh-studio-comment-compose-input"
        placeholder={placeholder}
        value={body}
        autoFocus
        onChange={event => { setBody(event.currentTarget.value) }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            event.stopPropagation()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      <div className="dsh-studio-comment-compose-actions">
        {canDelete && onDelete !== undefined ? (
          <Button
            variant="ghost"
            size="sm"
            className="dsh-studio-comment-compose-delete"
            onClick={onDelete}
          >
            {t('comments.delete')}
          </Button>
        ) : null}
        <div className="dsh-studio-comment-compose-spacer" />
        {onReference !== undefined ? (
          <Button variant="outline" size="sm" onClick={() => { onReference(body) }}>
            {t('comments.reference')}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('dialog.cancel')}
        </Button>
        <Button variant="primary" size="sm" disabled={empty} onClick={commit}>
          {submitLabel ?? t('comments.add')}
        </Button>
      </div>
    </div>
  )
}
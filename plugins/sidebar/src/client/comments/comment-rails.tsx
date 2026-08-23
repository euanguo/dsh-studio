/**
 * Shared hover-comment rails (R2): ONE affordance for adding and resolving
 * line comments across the pierre File viewer and FileDiff surfaces.
 *
 * Host wiring (both surfaces expose the same @pierre/diffs hooks):
 *   - `onLineEnter` / `onLineLeave`  → the rails remember the hovered line
 *     and its element (for precise overlay placement);
 *   - `renderGutterUtility`          → a `+` button floats in the line
 *     gutter while hovering a commented-free line;
 *   - `overlay()`                    → the floating composer rendered once
 *     in the host tree (createPortal to the surface layer).
 *
 * Composer keys: Enter commits, Shift+Enter inserts a newline, Esc dismisses
 * (the rails also intercepts document-level Esc so hotkeys never leak).
 * Two exits per composer, mirroring the reference workbench's comment-vs-
 * reference split: Comment (persisted WorkbenchComment, resolvable) and
 * Reference in chat (lightweight composer injection).
 *
 * The "v1" compose entry is single-line (startLine = endLine = hovered);
 * the model supports ranges, the UI affordance lands later.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { ToolbarAction } from '@dsh-studio/shared/ui'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import type { WorkbenchComment } from '../diff/diff-comments-store.ts'
import { commentCoversLine } from './comment-rails-core.ts'

export interface CommentRailsOptions {
  path: string
  /** Surface cwd (absolute/relative path reconciliation). */
  cwd: string
  comments: readonly WorkbenchComment[]
  t: Translate<WorkspaceMessage>
  /** Overlay portal host (the surface's scroll/shadow layer). */
  layer: HTMLElement | null
  onAdd(input: { path: string; startLine: number; endLine?: number; body: string }): void
  onResolve?(id: string): void
  onUnresolve?(id: string): void
  /** Reference-in-chat exit; 'unavailable' when no composer is reachable. */
  onReference?(input: { path: string; line: number; body: string }): 'inserted' | 'unavailable'
}

export interface CommentRails {
  onLineEnter(props: { lineNumber: number; lineElement: HTMLElement }): void
  onLineLeave(): void
  /** Pass to File/FileDiff `renderGutterUtility`. */
  gutterUtility(getHoveredLine?: () => { lineNumber: number } | undefined): ReactNode
  /** Render once inside the host tree. */
  overlay(): ReactNode
  /** Clear compose state when the opened file changes. */
  reset(): void
}

interface ComposeState {
  line: number
  top: number
  left: number
  atComment: boolean
}

export function useCommentRails(options: CommentRailsOptions): CommentRails {
  const { path, cwd, comments, t, layer, onAdd, onResolve, onUnresolve, onReference } = options
  const hoveredRef = useRef<{ line: number; rect: DOMRect } | null>(null)
  const [composing, setComposing] = useState<ComposeState | null>(null)
  const [body, setBody] = useState('')
  const overlayRef = useRef<HTMLTextAreaElement | null>(null)

  const hasCommentAt = useCallback((line: number): boolean =>
    comments.some(comment => commentCoversLine(comment, path, cwd, line)),
  [comments, cwd, path])

  const closeCompose = useCallback((): void => {
    setComposing(null)
    setBody('')
  }, [])

  useEffect(() => {
    if (composing === null) return
    overlayRef.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      closeCompose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [closeCompose, composing])

  const commit = useCallback((): void => {
    if (composing === null) return
    const trimmed = body.trim()
    if (trimmed === '') return
    onAdd({ path, startLine: composing.line, endLine: composing.line, body: trimmed })
    closeCompose()
  }, [body, closeCompose, composing, onAdd, path])

  const referenceInChat = useCallback((): void => {
    if (composing === null || onReference === undefined) return
    const trimmed = body.trim()
    const result = onReference({ path, line: composing.line, body: trimmed })
    if (result === 'inserted') closeCompose()
  }, [body, closeCompose, composing, onReference, path])

  const onLineEnter = useCallback((props: { lineNumber: number; lineElement: HTMLElement }): void => {
    hoveredRef.current = {
      line: props.lineNumber,
      rect: props.lineElement.getBoundingClientRect(),
    }
  }, [])

  const onLineLeave = useCallback((): void => {
    hoveredRef.current = null
  }, [])

  const gutterUtility = useCallback((getHoveredLine?: () => { lineNumber: number } | undefined): ReactNode => {
    const hovered = getHoveredLine?.()
    if (hovered === undefined || hovered === null) return null
    const line = hovered.lineNumber
    if (composing !== null && composing.line === line) return null
    if (hasCommentAt(line)) return null
    return (
      <ToolbarAction
        variant="ghost"
        className="dsh-studio-comment-rail-add"
        icon={<span aria-hidden="true">+</span>}
        label={t('comments.add-line')}
        onClick={() => {
          const rect = hoveredRef.current?.rect
          if (rect === undefined) return
          setComposing({
            line,
            top: rect.bottom + 4,
            left: rect.left + 28,
            atComment: false,
          })
          setBody('')
        }}
      />
    )
  }, [composing, hasCommentAt, t])

  const overlay = useCallback((): ReactNode => {
    if (composing === null || layer === null) return null
    const empty = body.trim() === ''
    return createPortal(
      <div
        className="dsh-studio-comment-compose"
        role="dialog"
        aria-label={t('comments.comment-on-line', { line: composing.line })}
        style={{ top: composing.top, left: composing.left }}
        onMouseDown={event => event.stopPropagation()}
        onPointerDown={event => event.stopPropagation()}
      >
        <div className="dsh-studio-comment-compose-head">{t('comments.comment-on-line', { line: composing.line })}</div>
        <textarea
          ref={overlayRef}
          className="dsh-studio-comment-compose-input"
          placeholder={t('comments.placeholder')}
          value={body}
          onChange={event => { setBody(event.currentTarget.value) }}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              event.stopPropagation()
              commit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              closeCompose()
            }
          }}
        />
        <div className="dsh-studio-comment-compose-actions">
          {onReference !== undefined ? (
            <Button variant="outline" size="sm" onClick={referenceInChat}>
              {t('comments.reference')}
            </Button>
          ) : null}
          <Button variant="primary" size="sm" disabled={empty} onClick={commit}>
            {t('comments.add')}
          </Button>
        </div>
      </div>,
      layer,
    )
  }, [body, closeCompose, commit, composing, layer, onReference, referenceInChat, t])

  const reset = useCallback((): void => {
    setComposing(null)
    setBody('')
  }, [])

  return { onLineEnter, onLineLeave, gutterUtility, overlay, reset }
}

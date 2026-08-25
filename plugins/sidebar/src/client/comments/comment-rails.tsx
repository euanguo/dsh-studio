/**
 * Shared hover-comment rails (R3): ONE affordance for adding and resolving
 * line comments across the pierre File viewer and FileDiff surfaces, and
 * the single compose-card family shared with the selection action bar.
 *
 * Host wiring (both surfaces expose the same @pierre/diffs hooks):
 *   - `onLineEnter` / `onLineLeave`  → the rails remember the hovered line
 *     and its element (for precise overlay placement);
 *   - `renderGutterUtility`          → a `+` button floats in the line
 *     gutter while hovering a commented-free line;
 *   - `overlay()`                    → the compose card rendered once in
 *     the host tree (createPortal to the surface layer).
 *   - `composeAt()`                  → open the same card from the selection
 *     action bar (anchored at the committed selection, range-capable).
 *
 * Composer keys: Enter commits, Shift+Enter inserts a newline, Esc dismisses
 * (the rails also intercepts document-level Esc so hotkeys never leak).
 * Exits per card, mirroring the reference workbench's comment-vs-reference
 * split: Comment (persisted WorkbenchComment, resolvable) and Reference in
 * chat (lightweight composer injection).
 */
import { SidebarSurfaceCss as surfaceCss } from '../styles.js'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ToolbarAction } from '@dsh-studio/shared/ui'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import type { WorkbenchComment } from '../diff/diff-comments-store.ts'
import { commentCoversLine } from './comment-rails-core.ts'
import { CommentComposeCard } from './comment-compose-card.tsx'
import { FloatingLayer } from '@dsh-studio/shared/ui'
import { useOverlayArbiter } from '../selection/overlay-arbiter.tsx'

export interface CommentRailsOptions {
  path: string
  /** Surface cwd (absolute/relative path reconciliation). Optional: a
   *  comment rail for a surface without a cwd stays inert (no comments match,
   *  compose never opens) so the host can call the hook unconditionally. */
  cwd?: string
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
  /** Open the compose card from the selection action bar (range-capable). */
  composeAt(anchor: { line: number; endLine?: number; top: number; left: number }): void
  /** Clear compose state when the opened file changes. */
  reset(): void
}

interface ComposeState {
  line: number
  endLine?: number
  top: number
  left: number
  atComment: boolean
}

export function useCommentRails(options: CommentRailsOptions): CommentRails {
  const { path, cwd, comments, t, layer, onAdd, onResolve, onUnresolve, onReference } = options
  const hoveredRef = useRef<{ line: number; rect: DOMRect } | null>(null)
  const [composing, setComposing] = useState<ComposeState | null>(null)
  const [body, setBody] = useState('')
  // The surface-level arbiter from context (C16): the picker and comment card
  // share one lock per surface and never deadlock across surfaces.
  const arbiter = useOverlayArbiter()

  const hasCommentAt = useCallback((line: number): boolean =>
    cwd === undefined ? false : comments.some(comment => commentCoversLine(comment, path, cwd, line)),
  [cwd, comments, path])

  const closeCompose = useCallback((): void => {
    arbiter.releaseExclusive('comment')
    setComposing(null)
    setBody('')
  }, [arbiter])

  useEffect(() => {
    if (composing === null) return
    const stopBlocked = arbiter.setOwnerBlockedHandler(owner => {
      if (owner === 'conv') closeCompose()
    })
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      closeCompose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      stopBlocked()
    }
  }, [arbiter, closeCompose, composing])

  const commit = useCallback((nextBody: string): void => {
    if (composing === null) return
    const trimmed = nextBody.trim()
    if (trimmed === '') return
    onAdd({
      path,
      startLine: composing.line,
      ...(composing.endLine === undefined ? {} : { endLine: composing.endLine }),
      body: trimmed,
    })
    closeCompose()
  }, [closeCompose, composing, onAdd, path])

  const referenceInChat = useCallback((nextBody: string): void => {
    if (composing === null || onReference === undefined) return
    const trimmed = nextBody.trim()
    const result = onReference({ path, line: composing.line, body: trimmed })
    if (result === 'inserted') closeCompose()
  }, [closeCompose, composing, onReference, path])

  const openCompose = useCallback((anchor: ComposeState): void => {
    // A rail without a resolved surface cwd cannot anchor a comment to a
    // stable path — stay inert so it never opens a card.
    if (cwd === undefined) return
    // The comment card and the conversation picker are mutually exclusive.
    if (!arbiter.requestExclusive('comment')) return
    setComposing(anchor)
    setBody('')
  }, [arbiter, cwd])

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
        className={surfaceCss["dsh-studio-comment-rail-add"]}
        icon={<span aria-hidden="true">+</span>}
        label={t('comments.add-line')}
        onClick={() => {
          const rect = hoveredRef.current?.rect
          if (rect === undefined) return
          openCompose({
            line,
            top: rect.bottom + 4,
            left: rect.left + 28,
            atComment: false,
          })
        }}
      />
    )
  }, [composing, hasCommentAt, openCompose, t])

  const composeAt = useCallback((anchor: { line: number; endLine?: number; top: number; left: number }): void => {
    openCompose({ ...anchor, atComment: false })
  }, [openCompose])

  const overlay = useCallback((): ReactNode => {
    if (composing === null) return null
    const lineLabel = composing.endLine !== undefined && composing.endLine > composing.line
      ? t('comments.comment-on-lines', { startLine: composing.line, endLine: composing.endLine })
      : t('comments.comment-on-line', { line: composing.line })
    const onReferenceExit = onReference === undefined
      ? undefined
      : (nextBody: string): void => { referenceInChat(nextBody) }
    return (
      <FloatingLayer
        open
        onOpenChange={next => { if (!next) closeCompose() }}
        anchor={{ x: composing.left, y: composing.top }}
        side="top"
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className={surfaceCss["dsh-studio-comment-floating"]}
      >
        <CommentComposeCard
          lineLabel={lineLabel}
          placeholder={t('comments.placeholder')}
          initialBody={body}
          onCommit={commit}
          {...(onReferenceExit === undefined ? {} : { onReference: onReferenceExit })}
          onCancel={closeCompose}
          t={t}
        />
      </FloatingLayer>
    )
  }, [body, closeCompose, commit, composing, onReference, referenceInChat, t])

  const reset = useCallback((): void => {
    // Clear compose state when the opened file changes. This MUST go through
    // the same release path as closeCompose so the exclusive comment lock is
    // released too — otherwise the conversation picker stays blocked forever
    // (C2: reset used to only clear local state and leaked `currentOwner`).
    closeCompose()
  }, [closeCompose])

  return { onLineEnter, onLineLeave, gutterUtility, overlay, composeAt, reset }
}
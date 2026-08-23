/**
 * Unified text-selection → action-bar host (the "选词 → 操作条" affordance).
 *
 * One document-level mouseup listener per hosting surface watches for a
 * text selection INSIDE the surface's container (shadow-DOM aware — the
 * Pierre viewers render their rows in open shadow roots) and floats the
 * `SelectedTextAction` pill near the committed selection.
 *
 * Capabilities are injected by the surface:
 *  - "add to chat": target-conversation dropdown (default = active session)
 *    through `conversation-targets.ts`; the payload is the reference project's
 *    `相对路径:起止行` fenced block (`buildSelectionInsert`).
 *  - "ask in side chat": fork the current session, open it, and append the
 *    selection as the first message.
 *  - "comment": hand the anchor to the surface's comment rails
 *    (`rails.composeAt`) so the full comment card opens at the selection.
 *  - "edit": inline instruction input (inside the pill); the instruction +
 *    selection reference are appended to the DEFAULT conversation's draft
 *    for the model to apply.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { toast } from '@dsh-studio/shared/toast'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import type { SessionsService } from '../client-types.ts'
import {
  afterSelectionCommit,
  buildSelectionInsert,
  containsNodeAcrossShadow,
  linesOfSelection,
  type FileLineSelection,
} from '../files/file-selection-reference.ts'
import {
  appendToConversation,
  insertReferenceIntoConversation,
  listConversationTargets,
  type AppendResult,
} from './conversation-targets.ts'
import {
  formatSelectionLabel,
  middleEllipsisPath,
  resolveSelectionSpanFromPoints,
} from './selection-reference.ts'
import { FloatingLayer } from '@dsh-studio/shared/ui'
import { SelectedTextAction } from './selected-text-action.tsx'

export interface SelectionActionAnchor {
  line?: number
  endLine?: number
  x: number
  y: number
}

/** Map a selection anchor into the comment rails' composeAt coordinate
 *  shape ({line, endLine?, top, left}). Line defaults to 1 when the
 *  selection carried no resolvable line. */
export function commentAnchorOf(anchor: SelectionActionAnchor): {
  line: number
  endLine?: number
  top: number
  left: number
} {
  return {
    line: anchor.line ?? 1,
    top: anchor.y,
    left: anchor.x,
    ...(anchor.endLine === undefined ? {} : { endLine: anchor.endLine }),
  }
}

export interface SelectionActionOverlayOptions {
  /** The surface content root the selection must live in. */
  containerRef: RefObject<HTMLElement | null>
  /** Absolute path of the opened file / diff target. */
  path: string
  /** Session cwd (relative `path:line` payloads) — optional. */
  cwd?: string | undefined
  /** The source text (for line reverse-search on markdown previews). */
  content?: string | null | undefined
  /** Portal target for the pill (usually `document.body`). */
  layer: HTMLElement | null
  /** Session roster for the target dropdown; absent hides "add to chat". */
  sessions?: SessionsService | null
  /** Opens the comment card at the selection anchor (rails.composeAt). */
  onComment?(anchor: SelectionActionAnchor): void
  /** Notified when the pill consumed a selection (overlay closes). */
  onConsumed?(): void
  /** Copy handler override; defaults to writing the reference payload. */
  onCopy?(text: string): void
  t: Translate<WorkspaceMessage>
}

interface SelectionState {
  text: string
  x: number
  y: number
  lines: FileLineSelection | null
  startColumn?: number
  endColumn?: number
}

export interface SelectionActionOverlay {
  /** Render once inside the surface tree (self-cleaning listeners). */
  overlay: ReactNode
  /** Drop a pending selection read (file changes, surface unmount). */
  reset(): void
}

/** Build the "edit request" message: instruction + selection reference. */
export function buildEditInstructionMessage(
  instruction: string,
  reference: string,
): string {
  const trimmed = instruction.trim()
  return trimmed === ''
    ? reference
    : `[Edit request]\n${trimmed}\n\n${reference}`
}

export function useSelectionActionOverlay(
  options: SelectionActionOverlayOptions,
): SelectionActionOverlay {
  const {
    containerRef,
    path,
    cwd,
    content,
    layer,
    sessions,
    onComment,
    onConsumed,
    t,
  } = options
  const [selection, setSelection] = useState<SelectionState | null>(null)

  const pendingReadRef = useRef<(() => void) | null>(null)
  // Live mirrors for the document listeners (avoid re-subscribing on every
  // render while the file loads / the content refines).
  const contentRef = useRef(content)
  contentRef.current = content
  const callbackRef = useRef({ path, cwd, onComment, onConsumed })
  callbackRef.current = { path, cwd, onComment, onConsumed }

  const sessionStore = sessions ?? null
  const sessionList = useSyncExternalStore(
    useCallback((notify: () => void) => (
      sessionStore === null ? () => {} : sessionStore.list.subscribe(notify)
    ), [sessionStore]),
    useCallback(() => (
      sessionStore === null ? null : sessionStore.list.getSnapshot()
    ), [sessionStore]),
  )
  const conversations = sessionList === null || sessionStore === null
    ? null
    : listConversationTargets(sessionStore)

  const close = useCallback((): void => {
    pendingReadRef.current?.()
    pendingReadRef.current = null
    setSelection(null)
  }, [])

  // Reset when the opened file changes (a pending read must never fire into
  // a stale container).
  useEffect(() => {
    setSelection(null)
  }, [path, containerRef])

  useEffect(() => {
    const insidePopup = (target: EventTarget | null): boolean =>
      target instanceof Element
      && target.closest('.dsh-studio-selection-action, .dsh-studio-comment-compose') !== null

    const readCommittedSelection = (
      selection: Selection,
      dragStart: { x: number; y: number },
      anchor: { x: number; y: number },
    ): void => {
      pendingReadRef.current = null
      const root = containerRef.current
      // Deliberately NOT gated on `selection.isCollapsed`: programmatic
      // (CDP) drag-select sequences can report a collapsed selection that
      // still carries text (the browser lands the committed state after the
      // rAF this callback runs in). The text + range checks are the
      // reliable signal, and every exit path keeps the overlay in sync.
      const text = selection.toString().replace(/\u00a0/g, ' ')
      if (selection.rangeCount === 0 || text.trim() === '') {
        setSelection(null)
        return
      }
      if (root !== null) {
        const met = selection.getRangeAt(0).commonAncestorContainer
        if (!(met === root || containsNodeAcrossShadow(root, met))) {
          setSelection(null)
          return
        }
      }
      // Line/column span: geometric mapping of the DRAG endpoints
      // (pointerdown → mouseup) onto the rendered row rects. This is the
      // reliable path for programmatic drag-selects, whose DOM range can be
      // collapsed/light-DOM-stranded while the rows' rects stay valid. A
      // markdown preview without line rows falls back to a reverse search
      // in the source text.
      let lines: FileLineSelection | null = null
      let startColumn: number | undefined
      let endColumn: number | undefined
      if (root !== null && dragStart.x !== 0 && dragStart.y !== 0) {
        const span = resolveSelectionSpanFromPoints(root, dragStart, anchor)
        if (span !== null) {
          lines = { startLine: span.startLine, endLine: span.endLine, text }
          startColumn = span.startColumn
          endColumn = span.endColumn
        }
      }
      if (lines === null) {
        const source = contentRef.current
        if (source !== undefined && source !== null && source !== '') {
          const found = linesOfSelection(source, text)
          lines = found === null
            ? null
            : { startLine: found.start, endLine: found.end, text }
        }
      }
      const x = anchor.x !== 0 || anchor.y !== 0 ? anchor.x : 0
      const y = anchor.y !== 0 ? anchor.y : 0
      setSelection({
        text,
        x,
        y,
        lines,
        ...(startColumn === undefined ? {} : { startColumn }),
        ...(endColumn === undefined ? {} : { endColumn }),
      })
    }

    /**
     * Whether a viewport point falls inside the hosting surface's content
     * container (so a click on the file tree / sidebar / anywhere outside
     * dismisses the bar immediately, instead of relying on a stale DOM
     * selection that can "follow the click").
     */
    const pointInsideContainer = (x: number, y: number): boolean => {
      const root = containerRef.current
      if (root === null) return false
      const r = root.getBoundingClientRect()
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    }

    let dragStartRef: { x: number; y: number } | null = null
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target === null || insidePopup(event.target)) return
      // A press outside the container always closes the bar — no DOM
      // selection dependency (fixes "clicking a tree file leaves the pill
      // floating").
      if (dragStartRef !== null || !pointInsideContainer(event.clientX, event.clientY)) {
        close()
      }
      dragStartRef = { x: event.clientX, y: event.clientY }
    }
    const onMouseUp = (event: MouseEvent): void => {
      if (event.target === null || insidePopup(event.target)) return
      const anchor = { x: event.clientX, y: event.clientY }
      // Click (not drag) outside the container: dismiss.
      if (dragStartRef !== null
        && Math.abs(anchor.x - dragStartRef.x) < 4
        && Math.abs(anchor.y - dragStartRef.y) < 4
        && !pointInsideContainer(anchor.x, anchor.y)) {
        dragStartRef = null
        close()
        return
      }
      const dragStart = dragStartRef ?? { x: anchor.x, y: anchor.y }
      dragStartRef = null
      pendingReadRef.current?.()
      pendingReadRef.current = afterSelectionCommit(sel => {
        readCommittedSelection(sel, dragStart, anchor)
      })
    }
    const onScroll = (event: Event): void => {
      const target = event.target
      if (target instanceof Node
        && containerRef.current !== null
        && containerRef.current.contains(target)) {
        close()
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('mouseup', onMouseUp, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', close)
    return () => {
      pendingReadRef.current?.()
      pendingReadRef.current = null
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('mouseup', onMouseUp, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', close)
    }
    // `path`/`containerRef` are stable per surface; `content`/callbacks ride
    // the refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef, close])

  const reset = useCallback((): void => {
    close()
  }, [close])

  if (selection === null) return { overlay: null, reset }

  const payload = buildSelectionInsert(
    path,
    cwd,
    selection.lines === null
      ? undefined
      : { start: selection.lines.startLine, end: selection.lines.endLine },
    selection.text,
  )

  const defaultTargetId = (): string | undefined =>
    conversations?.find(target => target.current)?.id ?? conversations?.[0]?.id

  /** The rich chip label: `…/i18n.ts:12:5-18:20` (path middle-ellipsized,
   *  line:col span). Falls back to the bare path when line resolution
   *  failed. */
  const chipLabel = (): string => {
    console.log('[chip-label] lines:', selection.lines, 'cols:', selection.startColumn, selection.endColumn, 'path:', path)
    if (selection.lines === null) return middleEllipsisPath(path)
    return formatSelectionLabel({
      path,
      span: {
        startLine: selection.lines.startLine,
        endLine: selection.lines.endLine,
        ...(selection.startColumn === undefined ? {} : { startColumn: selection.startColumn }),
        ...(selection.endColumn === undefined ? {} : { endColumn: selection.endColumn }),
      },
    })
  }

  const handleAddToConversation = (targetId: string | null, _text: string): AppendResult => {
    const effective = targetId ?? defaultTargetId()
    if (effective === undefined || sessionStore === null) return 'unavailable'
    // Insert as an inline reference chip (styled block in the composer), not
    // raw text: label = `…/path:line:col-line:col`, clipboardText = payload.
    return insertReferenceIntoConversation(sessionStore, effective, {
      label: chipLabel(),
      clipboardText: payload,
    })
  }

  const handleAskInSideChat = async (_text: string): Promise<void> => {
    if (sessionStore === null) return
    const snapshot = sessionStore.list.getSnapshot()
    const current = snapshot.current
    const child = current === undefined
      ? undefined
      : await sessionStore.fork({ sessionId: current, increaseTitle: true })
    const target = child ?? current
    if (target === undefined) return
    sessionStore.open(target)
    insertReferenceIntoConversation(sessionStore, target, {
      label: chipLabel(),
      clipboardText: payload,
    })
  }

  const handleEdit = async (_input: { instruction: string; text: string }): Promise<'done' | 'retry' | 'unavailable'> => {
    const effective = defaultTargetId()
    if (effective === undefined || sessionStore === null) return 'unavailable'
    // Edit request: plain-text instruction line, then the selection as a
    // reference chip right after it (both land in the same draft).
    const message = buildEditInstructionMessage(_input.instruction, '')
    const textResult = appendToConversation(sessionStore, effective, message.trim())
    const chipResult = insertReferenceIntoConversation(sessionStore, effective, {
      label: chipLabel(),
      clipboardText: payload,
    })
    return textResult === 'inserted' || chipResult === 'inserted'
      ? 'done'
      : 'unavailable'
  }

  const handleComment = (input: { text: string; anchorRect?: DOMRect }): void => {
    const lines = selection.lines
    // Anchor the comment card ABOVE the comment button (button top): the
    // button lives inside the action bar, so anchoring above avoids the card
    // covering the bar it came from. The floating engine still flips to the
    // bottom when there is no room above.
    const rect = input.anchorRect
    onComment?.({
      ...(lines === null ? {} : { line: lines.startLine, endLine: lines.endLine }),
      ...(rect === undefined
        ? { x: selection.x, y: selection.y - 4 }
        : { x: rect.left, y: rect.top - 4 }),
    })
  }

  const handleCopy = (): void => {
    void writeClipboard(payload).then(ok => {
      toast(ok ? t('selection.copied') : t('selection.copy-failed'))
    })
  }

  // The action bar rides a base-ui FloatingLayer: anchored at the selection
  // point, with floating-ui handling side-flip / align-shift / viewport
  // clamping (no hand-rolled edge math). open while the selection state is
  // set; closing only ever happens through a consumed action.
  const overlay: ReactNode = (
    <FloatingLayer
      open
      anchor={{ x: selection.x, y: selection.y + 12 }}
      side="bottom"
      align="start"
      className="dsh-studio-selection-floating"
    >
      <SelectedTextAction
        selectedText={selection.text}
        conversations={conversations}
        defaultConversationId={defaultTargetId()}
        onAddToConversation={handleAddToConversation}
        onAskInSideChat={handleAskInSideChat}
        {...(onComment === undefined ? {} : { onComment: handleComment })}
        onEdit={handleEdit}
        onCopy={handleCopy}
        onConsumed={() => { onConsumed?.(); setSelection(null) }}
        t={t}
      />
    </FloatingLayer>
  )

  return { overlay, reset }
}
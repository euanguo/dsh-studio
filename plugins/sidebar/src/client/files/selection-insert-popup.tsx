/**
 * Selection → "add to conversation" popup for the text viewers (markdown
 * preview + the catch-all code viewer).
 *
 * A document-level mouseup listener watches for a text selection inside the
 * hosting container and floats a small popup near the caret with an
 * "添加到对话" button. The payload is built by the pure builders in
 * `file-selection-reference.ts` (fenced block with a `相对路径:起止行` info
 * line while ≤ SELECTION_LIMIT chars, plain path line beyond) and appended
 * into the composer draft through the review-comments channel
 * (`ReviewCommentsService.appendToComposer`).
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Translate } from '@dsh-studio/shared/i18n'
import type { WorkspaceMessage } from '../i18n.ts'
import {
  afterSelectionCommit,
  buildSelectionInsert,
  containsNodeAcrossShadow,
  linesOfSelection,
  SELECTION_LIMIT,
} from './file-selection-reference.ts'

export interface SelectionInsertHostProps {
  /** The container the selection must live in (the content root). */
  containerRef: RefObject<HTMLElement | null>
  /** Absolute path of the opened file. */
  path: string
  /** Session cwd (relative header paths); undefined = absolute header. */
  cwd: string | undefined
  /** The source text (for the md preview: the raw markdown source). */
  content: string
  /** Append the payload into the composer; 'unavailable' when the current
   *  session has no reachable composer input. */
  onAddSelection(text: string): 'inserted' | 'unavailable'
  t: Translate<WorkspaceMessage>
}

interface PopupState {
  x: number
  y: number
  text: string
}

/** Reset the popup when the opened file changes. */
function usePopupReset(
  containerRef: RefObject<HTMLElement | null>,
  path: string,
  setPopup: (value: PopupState | null) => void,
): void {
  useEffect(() => {
    setPopup(null)
  }, [path, containerRef, setPopup])
}

/**
 * The floating popup + its document listeners. Renders null when no
 * selection is anchored, so consumers drop it inline next to the viewer.
 */
export function SelectionInsertPopup({
  containerRef,
  path,
  cwd,
  content,
  onAddSelection,
  t,
}: SelectionInsertHostProps): JSX.Element | null {
  const [popup, setPopup] = useState<PopupState | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  usePopupReset(containerRef, path, setPopup)

  useEffect(() => {
    const close = (): void => { setPopup(null) }
    const insidePopup = (target: EventTarget | null): boolean =>
      target instanceof Node && popupRef.current !== null && popupRef.current.contains(target)
    // The selection is NOT committed yet while the mouseup event runs — a
    // shadow-tree selection (the Pierre viewers render their rows in an
    // open shadow root) lands in the rendering step AFTER the event. The
    // gesture records its anchor point and reads the committed selection
    // through `afterSelectionCommit` (selectionchange + rAF fallback).
    let stopPendingRead: (() => void) | null = null
    const readCommittedSelection = (
      selection: Selection,
      anchor: { x: number; y: number },
    ): void => {
      const container = containerRef.current
      if (selection.isCollapsed || selection.rangeCount === 0) {
        close()
        return
      }
      const text = selection.toString().replace(/\u00a0/g, ' ')
      if (text.trim() === '') {
        close()
        return
      }
      if (container !== null) {
        const range = selection.getRangeAt(0)
        const met = range.commonAncestorContainer
        // The container check must climb shadow-DOM boundaries: Pierre
        // code/markdown-source viewers render their rows in a shadow root,
        // where `container.contains(met)` is always false.
        if (!(met === container || containsNodeAcrossShadow(container, met))) {
          close()
          return
        }
      }
      // Purely positional calls (keyboard selection, programmatic focus)
      // carry a zero client point; anchor above the target then.
      const x = anchor.x !== 0 || anchor.y !== 0
        ? anchor.x
        : 0
      const y = anchor.y !== 0
        ? anchor.y + 16
        : 0
      setPopup({ x, y, text })
    }
    const onMouseUp = (event: MouseEvent): void => {
      if (insidePopup(event.target)) return
      const anchor = { x: event.clientX, y: event.clientY }
      stopPendingRead?.()
      stopPendingRead = afterSelectionCommit(selection => {
        stopPendingRead = null
        readCommittedSelection(selection, anchor)
      })
    }
    const onScroll = (event: Event): void => {
      // Scrolling the content under a floating popup leaves a stale caret
      // anchor; close when the scroll happened inside the host container.
      const target = event.target
      if (target instanceof Node
        && containerRef.current !== null
        && containerRef.current.contains(target)) {
        close()
      }
    }
    document.addEventListener('mouseup', onMouseUp, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', close)
    return () => {
      stopPendingRead?.()
      stopPendingRead = null
      document.removeEventListener('mouseup', onMouseUp, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', close)
    }
  }, [containerRef])

  if (popup === null) return null
  const lines = linesOfSelection(content, popup.text)
  const payload = buildSelectionInsert(path, cwd, lines ?? undefined, popup.text)
  const lineLabel = lines === null
    ? ''
    : lines.end > lines.start ? `${lines.start}-${lines.end}` : String(lines.start)
  return (
    <div
      ref={popupRef}
      className="dsh-studio-selection-insert"
      role="dialog"
      aria-label={t('files.selection-add')}
      style={{ left: popup.x, top: popup.y }}
      onMouseDown={event => { event.preventDefault() }}
    >
      <span className="dsh-studio-selection-insert-meta">
        {popup.text.length > SELECTION_LIMIT
          ? t('files.selection-over-limit')
          : `${popup.text.length} chars${lineLabel === '' ? '' : ` · ${lineLabel}`}`}
      </span>
      <button
        type="button"
        onClick={() => {
          onAddSelection(payload)
          setPopup(null)
        }}
      >
        {t('files.selection-add')}
      </button>
    </div>
  )
}
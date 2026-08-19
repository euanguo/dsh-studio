/**
 * Pure helpers for source-view selection → chat/file reference labels.
 * Maps DOM selection inside a code container to 1-based line ranges.
 * Ported from Synara `entities/file-selection-reference.ts`.
 */
import { relativePathOf } from '@dsh-studio/shared/path'

export type FileLineSelection = Readonly<{
  startLine: number
  endLine: number
  text: string
}> 

export function formatFileSelectionReference(input: {
  path: string
  selection: FileLineSelection | null
}): string {
  if (input.selection === null) {
    return input.path
  }
  const { startLine, endLine } = input.selection
  if (startLine === endLine) {
    return `${input.path}:${startLine}`
  }
  return `${input.path}:${startLine}-${endLine}`
}

/**
 * True when `node` is `container` itself or nested inside it, across shadow
 * DOM boundaries. A selection anchored inside a custom element's open
 * shadow root (the Pierre file/diff viewers render their rows in one)
 * reports a commonAncestorContainer in that shadow tree, which the plain
 * `Node.contains` does not see through the boundary — the shadow HOST (a
 * light-DOM child of the container) is what must be checked instead.
 */
export function containsNodeAcrossShadow(container: Node, node: Node): boolean {
  let current: Node | null = node
  while (current !== null) {
    if (current === container || container.contains(current)) return true
    const root = current.getRootNode()
    // `typeof` gate keeps the helper importable in non-DOM environments
    // (unit tests run under node:test without jsdom).
    current = typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot
      ? root.host
      : null
  }
  return false
}

/**
 * Run `callback` once the browser has COMMITTED the current selection.
 *
 * A mouseup handler reads a stale selection: the browser lands the new
 * selection (especially a shadow-tree one — the Pierre viewers render their
 * rows in an open shadow root) in the rendering step that follows the
 * event. Two rAF ticks are guaranteed to run after that commit (the
 * selectionchange event is NOT used: shadow-tree selection changes are not
 * reported to the document, and the document's own collapse changes fire
 * too early). Returns a canceller so the owner can drop a pending read
 * (e.g. when the popup closes for another reason).
 *
 * Note: the callback only runs while the window is foregrounded — rAF is
 * paused for hidden windows, and a hidden window cannot receive the mouse
 * gesture this helper settles anyway.
 */
export function afterSelectionCommit(
  callback: (selection: Selection) => void,
): () => void {
  let cancelled = false
  const frame1 = requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (cancelled) return
      const selection = globalThis.getSelection?.()
      if (selection !== null && selection !== undefined) callback(selection)
    })
  })
  return () => {
    cancelled = true
    cancelAnimationFrame(frame1)
  }
}

/**
 * Resolve a browser selection to line numbers when anchors live under `.line`
 * elements (Prism / plain numbered source) or Pierre rows (`data-column-
 * number` in the viewer's shadow root). Falls back to null when the
 * selection is empty or outside `container` (shadow-aware).
 */
export function getLineSelectionWithin(container: HTMLElement): FileLineSelection | null {
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }
  const range = selection.getRangeAt(0)
  if (!containsNodeAcrossShadow(container, range.commonAncestorContainer)) {
    return null
  }
  const text = selection.toString().replace(/\u00a0/g, ' ')
  if (text.trim().length === 0) {
    return null
  }
  const startLine = lineNumberFromNode(container, range.startContainer, range.startOffset)
  const endLine = lineNumberFromNode(container, range.endContainer, range.endOffset)
  if (startLine === null || endLine === null) {
    return null
  }
  return {
    startLine: Math.min(startLine, endLine),
    endLine: Math.max(startLine, endLine),
    text,
  }
}

function lineNumberFromNode(container: HTMLElement, node: Node, offset: number): number | null {
  let el: Element | null =
    node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  while (el !== null) {
    if (el !== container) {
      // Pierre File rows carry `data-column-number` (1-based, the number
      // painted in the gutter) — resolvable inside the viewer's shadow
      // root without crossing into light DOM.
      const dataColumn = el.getAttribute('data-column-number')
      if (dataColumn !== null) {
        const parsed = Number.parseInt(dataColumn, 10)
        if (Number.isFinite(parsed)) return parsed
      }
      const dataLine = el.getAttribute('data-line')
      if (dataLine !== null) {
        const parsed = Number.parseInt(dataLine, 10)
        if (Number.isFinite(parsed)) return parsed
      }
      if (el.classList.contains('line')) {
        const lines = Array.from(container.querySelectorAll('.line'))
        const index = lines.indexOf(el)
        if (index >= 0) return index + 1
      }
    }
    if (el === container) break
    // Cross the shadow boundary upward: the selection lives inside a
    // viewer shadow root, so hop to its host (a light-DOM child) and keep
    // walking toward the container.
    const root = el.getRootNode()
    if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot && root.host !== null) {
      el = root.host
      continue
    }
    el = el.parentElement
  }
  // Fallback: count newlines before caret in full text content.
  try {
    const preRange = document.createRange()
    preRange.selectNodeContents(container)
    preRange.setEnd(node, offset)
    const prefix = preRange.toString()
    return prefix.split('\n').length
  } catch {
    return null
  }
}

/* ── "add selection to conversation" payload builders ───────────────────
 * Ported from the upstream `src/client/selection-payload.ts`:
 * - Selection ≤ SELECTION_LIMIT characters: a fenced code block whose info
 *   line is `相对路径:起止行` and whose body is the selected text.
 * - Selection over the limit: a single plain-text line `相对路径:起止行`
 *   (no fence, no content).
 * - The path is relative to the session cwd; an unknown cwd falls back to
 *   the absolute path.
 * - Line numbers: single-line selections write `path:12`, multi-line write
 *   `path:12-15`. The markdown preview cannot map rendered DOM back to
 *   source lines directly, so it reverse-searches the selected text in the
 *   source and only reports lines on an unambiguous hit (linesOfSelection).
 */

/** Max inserted selection length (UTF-16 code units, i.e. JS `.length`). */
export const SELECTION_LIMIT = 500

/** The source line span a selection maps to (1-based, inclusive). */
export interface SelectionLines {
  start: number
  end: number
}

/**
 * The fence info line: `rel[:start[-end]]` — lines are omitted entirely
 * when unknown (the preview reverse-search missed).
 */
export function headerOf(
  path: string,
  cwd: string | undefined,
  lines?: SelectionLines,
): string {
  const rel = cwd !== undefined ? relativePathOf(cwd, path) : path
  if (lines === undefined) return rel
  if (lines.end > lines.start) return `${rel}:${lines.start}-${lines.end}`
  return `${rel}:${lines.start}`
}

/**
 * The full text appended to the composer draft for one selection.
 * Over the limit the content is dropped: the plain path line is the whole
 * payload (an empty fenced block would just occupy the draft).
 */
export function buildSelectionInsert(
  path: string,
  cwd: string | undefined,
  lines: SelectionLines | undefined,
  selected: string,
): string {
  const header = headerOf(path, cwd, lines)
  if (selected.length > SELECTION_LIMIT) return header
  return `\`\`\`${header}\n${selected}\n\`\`\``
}

/** 1-based line number of a character index in a text. */
function lineAt(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1
  }
  return line
}

/**
 * Reverse-map a rendered-DOM selection back to source line numbers. The
 * preview selection is plain text (block boundaries come out as `\n`), so
 * this is a best-effort substring search: a single trailing newline is
 * stripped first (DOM block selections tend to carry one), and only an
 * EXACTLY-ONE occurrence yields lines — an ambiguous or missing match
 * returns null (the header then carries the path without line numbers).
 */
export function linesOfSelection(
  source: string,
  selected: string,
): SelectionLines | null {
  const text = selected.endsWith('\n') ? selected.slice(0, -1) : selected
  if (text === '') return null
  const at = source.indexOf(text)
  if (at === -1) return null
  if (source.indexOf(text, at + 1) !== -1) return null
  return {
    start: lineAt(source, at),
    end: lineAt(source, at + Math.max(text.length - 1, 0)),
  }
}

/**
 * Rich selection-reference helpers (pure): column resolution, path
 * middle-ellipsis, and the chip label format.
 *
 * The selection action bar turns a text selection into a structured
 * reference — `path:startLine:startCol-endLine:endCol` — that is displayed
 * as an inline block (chip) in the composer. Everything here is
 * unit-testable under node --test (no DOM needed except columnFromNode,
 * which degrades to null outside a DOM).
 */

export interface SelectionSpan {
  startLine: number
  endLine: number
  /** 1-based character offset within the start line. */
  startColumn?: number
  /** 1-based character offset within the end line (inclusive). */
  endColumn?: number
}

export interface SelectionReference {
  path: string
  span: SelectionSpan
}

/* ── robust span resolution (shadow-aware) ────────────────────────────── */

/**
 * Collect the rendered line elements under `container`, crossing open
 * shadow roots (the Pierre viewers render their rows inside one). A line
 * element is any element carrying `data-column-number` / `data-line` or the
 * `.line` class.
 */
function collectLineElements(container: HTMLElement): Element[] {
  const out: Element[] = []
  const seen = new Set<Element>()
  const walk = (root: ParentNode): void => {
    // Prefer the full-width `[data-line]` rows (the Pierre code rows; a
    // unified diff carries the NEW-side line number). The narrow
    // `[data-column-number]` gutter elements are skipped so each logical
    // line is counted once.
    const rows = root.querySelectorAll('[data-line]')
    for (const el of rows) {
      if (!seen.has(el)) { seen.add(el); out.push(el) }
    }
    const lines = root.querySelectorAll('.line')
    for (const el of lines) {
      if (!seen.has(el)) { seen.add(el); out.push(el) }
    }
    const all = root.querySelectorAll('*')
    for (const el of all) {
      const shadow = (el as Element).shadowRoot
      if (shadow !== null && shadow !== undefined) walk(shadow)
    }
  }
  walk(container)
  return out
}

function lineNumberOf(el: Element): number | null {
  const dataLine = el.getAttribute('data-line')
  if (dataLine !== null) {
    const parsed = Number.parseInt(dataLine, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  const dataColumn = el.getAttribute('data-column-number')
  if (dataColumn !== null) {
    const parsed = Number.parseInt(dataColumn, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * Resolve the selection's line/column span robustly. Unlike the
 * container-walk approach, this works even when the selection's
 * startContainer is a light-DOM wrapper (the CDP drag-select can anchor at
 * a light-DOM boundary): it finds the rendered line elements that the
 * selection range intersects, then resolves columns against the first/last
 * intersecting line via caret positions at the selection's visual edges.
 *
 * Returns null when no line element intersects the selection.
 */
export function resolveSelectionSpan(container: HTMLElement): SelectionSpan | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)

  const lineEls = collectLineElements(container)
  // Geometric intersection: `range.intersectsNode` fails for shadow-DOM rows
  // when the selection's boundary points sit in light DOM (the CDP
  // drag-select can anchor there). Compare each row's bounding rect against
  // the selection's client rects instead — a row is selected when its rect
  // overlaps any selection rect.
  const selRects = Array.from(range.getClientRects())
  if (selRects.length === 0) return null
  const intersecting: Array<{ el: Element; line: number }> = []
  for (const el of lineEls) {
    const line = lineNumberOf(el)
    if (line === null) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) continue
    const hit = selRects.some(sr =>
      sr.left < r.right && sr.right > r.left && sr.top < r.bottom && sr.bottom > r.top,
    )
    if (hit) intersecting.push({ el, line })
  }
  if (intersecting.length === 0) return null

  const startLine = Math.min(...intersecting.map(x => x.line))
  const endLine = Math.max(...intersecting.map(x => x.line))
  const startEl = intersecting.find(x => x.line === startLine)?.el
  const endEl = intersecting.find(x => x.line === endLine)?.el

  let startColumn: number | undefined
  let endColumn: number | undefined
  const rects = range.getClientRects()
  if (rects.length > 0) {
    const first = rects[0]
    const last = rects[rects.length - 1]
    if (startEl !== undefined && first !== undefined) {
      startColumn = columnAtPoint(startEl, first.left + 1, first.top + 1) ?? undefined
    }
    if (endEl !== undefined && last !== undefined) {
      endColumn = columnAtPoint(endEl, last.right - 1, last.bottom - 1) ?? undefined
    }
  }
  return {
    startLine,
    endLine,
    ...(startColumn === undefined ? {} : { startColumn }),
    ...(endColumn === undefined ? {} : { endColumn }),
  }
}

/** Column of the caret at viewport point (x, y) within `lineElement`. */
function columnAtPoint(lineElement: Element, x: number, y: number): number | null {
  const caret = caretFromPoint(x, y)
  if (caret === null) return null
  return columnFromNode(lineElement, caret.node, caret.offset)
}

/**
 * Map a viewport point to the line number whose rendered row rect contains
 * it (shadow-aware). Returns null when the point falls outside every row.
 */
export function lineNumberAtPoint(container: HTMLElement, x: number, y: number): number | null {
  const lineEls = collectLineElements(container)
  for (const el of lineEls) {
    const line = lineNumberOf(el)
    if (line === null) continue
    const r = el.getBoundingClientRect()
    if (r.height === 0) continue
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return line
  }
  // Fallback: nearest row by vertical band (a click just past a row's text
  // end still belongs to that row).
  let best: { line: number; dy: number } | null = null
  for (const el of lineEls) {
    const line = lineNumberOf(el)
    if (line === null) continue
    const r = el.getBoundingClientRect()
    if (r.height === 0) continue
    const dy = Math.abs(y - (r.top + r.height / 2))
    if (best === null || dy < best.dy) best = { line, dy }
  }
  return best === null ? null : best.line
}

/**
 * Resolve the line/column span from the DRAG endpoints (pointerdown +
 * mouseup viewport coordinates) instead of the DOM selection range. This is
 * the reliable path for programmatic drag-selects: the CDP-synthesized
 * selection can report `isCollapsed` while still carrying text, with range
 * boundaries stranded in light DOM (`getClientRects()` empty). The rows'
 * own rects remain trustworthy.
 *
 * The whole row span is derived geometrically; columns are best-effort via
 * caret positions (degrade to undefined when unavailable).
 */
export function resolveSelectionSpanFromPoints(
  container: HTMLElement,
  start: { x: number; y: number },
  end: { x: number; y: number },
): SelectionSpan | null {
  if (typeof document === 'undefined') return null
  const startLine = lineNumberAtPoint(container, start.x, start.y)
  const endLine = lineNumberAtPoint(container, end.x, end.y)
  if (startLine === null || endLine === null) return null
  const lo = Math.min(startLine, endLine)
  const hi = Math.max(startLine, endLine)

  // Columns: caret at the endpoints (best-effort; shadow caret probing may
  // land on a light-DOM wrapper — then columns stay undefined).
  const startEl = lineElementAtPoint(container, start.x, start.y)
  const endEl = lineElementAtPoint(container, end.x, end.y)
  const startColumn = startEl === null
    ? undefined
    : (columnAtPoint(startEl, start.x, start.y) ?? undefined)
  const endColumn = endEl === null
    ? undefined
    : (columnAtPoint(endEl, end.x, end.y) ?? undefined)

  return {
    startLine: lo,
    endLine: hi,
    ...(startColumn === undefined ? {} : { startColumn }),
    ...(endColumn === undefined ? {} : { endColumn }),
  }
}

/** The line element whose rect contains the point, or null. */
function lineElementAtPoint(container: HTMLElement, x: number, y: number): Element | null {
  const lineEls = collectLineElements(container)
  for (const el of lineEls) {
    const r = el.getBoundingClientRect()
    if (r.height === 0) continue
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el
  }
  return null
}

function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretRangeFromPoint?(x: number, y: number): Range | null
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    const r = doc.caretRangeFromPoint(x, y)
    if (r !== null) return { node: r.startContainer, offset: r.startOffset }
  }
  if (typeof doc.caretPositionFromPoint === 'function') {
    const p = doc.caretPositionFromPoint(x, y)
    if (p !== null) return { node: p.offsetNode, offset: p.offset }
  }
  return null
}

/* ── columns ──────────────────────────────────────────────────────────── */

/**
 * Resolve the 1-based column of `offset` inside `node` relative to the
 * beginning of its line element: a Range from the line element's first
 * character up to (node, offset), counting the text after the last newline.
 *
 * Returns null when DOM APIs are unavailable or the range cannot be built
 * (callers fall back to a line-only span).
 */
export function columnFromNode(
  lineElement: Element,
  node: Node,
  offset: number,
): number | null {
  if (typeof document === 'undefined' || typeof Range === 'undefined') {
    return null
  }
  try {
    const r = document.createRange()
    r.selectNodeContents(lineElement)
    r.setEnd(node, offset)
    const prefix = r.toString().replace(/\u00a0/g, ' ')
    const lastBreak = prefix.lastIndexOf('\n')
    const col = (lastBreak === -1 ? prefix : prefix.slice(lastBreak + 1)).length
    return col + 1
  } catch {
    return null
  }
}

/* ── path middle-ellipsis ─────────────────────────────────────────────── */

/**
 * Middle-ellipsize a path for chip display: keep the first segment and the
 * last `tail` segments, collapsing everything between into `…`. Short
 * paths (≤ `budget` characters) are returned unchanged.
 *
 *   plugins/sidebar/src/client/i18n.ts → plugins/…/client/i18n.ts
 */
export function middleEllipsisPath(path: string, budget = 42, tail = 2): string {
  if (path.length <= budget) return path
  const parts = path.split('/')
  if (parts.length <= tail + 1) {
    return ellipsizeMiddle(path, budget)
  }
  const candidate = [parts[0], '…', ...parts.slice(parts.length - tail)].join('/')
  if (candidate.length <= budget) return candidate
  return ellipsizeMiddle(parts.slice(parts.length - tail).join('/'), budget)
}

function ellipsizeMiddle(text: string, budget: number): string {
  if (text.length <= budget) return text
  const keep = Math.max(1, Math.floor((budget - 1) / 2))
  return `${text.slice(0, keep)}…${text.slice(text.length - keep)}`
}

/* ── chip label ───────────────────────────────────────────────────────── */

/**
 * The chip label shown inside the composer block:
 *
 *   plugins/…/client/i18n.ts:12:5-18:20   lines 12–18, cols 5–20
 *   plugins/…/client/i18n.ts:12:5         single line, col 5
 *   plugins/…/client/i18n.ts:12-15        multi-line, columns unknown
 *   plugins/…/client/i18n.ts:12           single line, column unknown
 */
export function formatSelectionLabel(ref: SelectionReference): string {
  const path = middleEllipsisPath(ref.path)
  const { startLine, endLine, startColumn, endColumn } = ref.span
  const linePart = startLine === endLine
    ? `${startLine}`
    : `${startLine}-${endLine}`
  const colPart = startColumn === undefined
    ? ''
    : startLine === endLine && endColumn !== undefined
      ? `:${startColumn}-${endColumn}`
      : `:${startColumn}`
  return `${path}:${linePart}${colPart}`
}

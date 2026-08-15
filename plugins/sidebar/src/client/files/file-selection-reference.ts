/**
 * Pure helpers for source-view selection → chat/file reference labels.
 * Maps DOM selection inside a code container to 1-based line ranges.
 * Ported from Synara `entities/file-selection-reference.ts`.
 */

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
 * Resolve a browser selection to line numbers when anchors live under `.line`
 * elements (Prism / plain numbered source). Falls back to null when the
 * selection is empty or outside `container`.
 */
export function getLineSelectionWithin(container: HTMLElement): FileLineSelection | null {
  const selection = window.getSelection()
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
    return null
  }
  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) {
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
  while (el !== null && el !== container) {
    // Pierre File rows carry `data-line` = 1-based line number.
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

/**
 * Canvas-measured middle truncation (Codex `MiddleTruncatedText` pattern),
 * ported from the reference project's `shared/middle-truncate-text.ts`:
 * binary-search retained character count, keep head…tail as one string.
 * No dual-span layout — avoids flex gap between base and extension.
 */

const ELLIPSIS = '…'

let measurementCanvasContext: CanvasRenderingContext2D | null | undefined

export function measureTextWidth(text: string, font: string): number {
  if (typeof document === 'undefined') {
    return Number.POSITIVE_INFINITY
  }
  if (measurementCanvasContext === undefined) {
    measurementCanvasContext = document.createElement('canvas').getContext('2d')
  }
  if (measurementCanvasContext == null) {
    return Number.POSITIVE_INFINITY
  }
  measurementCanvasContext.font = font
  return measurementCanvasContext.measureText(text).width
}

export function fitsOnSingleLine(
  text: string,
  maxWidthPx: number,
  measure: (value: string) => number,
): boolean {
  return measure(text) <= maxWidthPx
}

/**
 * True middle ellipsis: `prefix…suffix`, balanced around the center.
 * Mirrors Codex `middleTruncateText` / `computeMiddleTruncation`.
 */
export function middleTruncateText(
  text: string,
  maxWidthPx: number,
  measure: (value: string) => number = (value) => measureTextWidth(value, '12px sans-serif'),
): string {
  if (text.length === 0 || maxWidthPx <= 0 || fitsOnSingleLine(text, maxWidthPx, measure)) {
    return text
  }

  const characters = Array.from(text)
  let best = ELLIPSIS
  let low = 0
  let high = characters.length - 1

  while (low <= high) {
    const retainedCharacterCount = Math.floor((low + high) / 2)
    const prefixLength = Math.ceil(retainedCharacterCount / 2)
    const suffixLength = Math.floor(retainedCharacterCount / 2)
    const candidate = `${characters.slice(0, prefixLength).join('')}${ELLIPSIS}${characters
      .slice(characters.length - suffixLength)
      .join('')}`

    if (fitsOnSingleLine(candidate, maxWidthPx, measure)) {
      best = candidate
      low = retainedCharacterCount + 1
    } else {
      high = retainedCharacterCount - 1
    }
  }

  return best
}

/**
 * Filename middle truncate that prefers keeping a short extension suffix.
 * Falls back to plain middle truncate when the extension alone does not fit.
 */
export function middleTruncateFilename(
  name: string,
  maxWidthPx: number,
  measure: (value: string) => number,
  extension: string,
): string {
  if (extension.length === 0) {
    return middleTruncateText(name, maxWidthPx, measure)
  }
  if (fitsOnSingleLine(name, maxWidthPx, measure)) {
    return name
  }

  const extensionWidth = measure(extension)
  // Extension itself must fit; otherwise generic middle truncate.
  if (extensionWidth >= maxWidthPx) {
    return middleTruncateText(name, maxWidthPx, measure)
  }

  const base = name.slice(0, name.length - extension.length)
  const availableForBase = maxWidthPx - extensionWidth
  if (availableForBase <= measure(ELLIPSIS)) {
    // Only extension (+ maybe ellipsis) fits.
    if (fitsOnSingleLine(`${ELLIPSIS}${extension}`, maxWidthPx, measure)) {
      return `${ELLIPSIS}${extension}`
    }
    return middleTruncateText(name, maxWidthPx, measure)
  }

  const truncatedBase = middleTruncateText(base, availableForBase, measure)
  return `${truncatedBase}${extension}`
}

export function readElementTextFont(element: HTMLElement): string {
  const style = getComputedStyle(element)
  // Canvas font shorthand: style weight size family
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`.trim()
}

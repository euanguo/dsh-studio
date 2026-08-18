/**
 * Append-optimized terminal scrollback history buffer (ported from synara's
 * `apps/server/src/terminal/terminalHistory.ts`).
 *
 * Appending is O(chunk): chunks are pushed raw and whole front chunks are
 * dropped once they fall outside the byte ceiling. The precise replay-safe
 * line/byte capping (`capHistoryByLimits`, cutting preferentially on ESC or LF
 * boundaries to prevent split ANSI sequences) runs lazily in `toString()`.
 */

export const DEFAULT_HISTORY_BYTE_LIMIT = 1_048_576 // 1 MB
export const DEFAULT_HISTORY_LINE_LIMIT = 5_000

export interface HistoryLimits {
  maxLines: number
  maxBytes: number
}

export function capHistoryLines(history: string, maxLines: number): string {
  if (history.length === 0) return history
  const hasTrailingNewline = history.endsWith('\n')
  const lines = history.split('\n')
  if (hasTrailingNewline) {
    lines.pop()
  }
  if (lines.length <= maxLines) return history
  const capped = lines.slice(lines.length - maxLines).join('\n')
  return hasTrailingNewline ? `${capped}\n` : capped
}

export function capHistoryBytes(history: string, maxBytes: number, scanWindow = 65_536): string {
  if (history.length === 0) return history
  if (maxBytes <= 0) return ''

  const buf = Buffer.from(history, 'utf8')
  if (buf.length <= maxBytes) return history

  const cut = buf.length - maxBytes
  const scanLimit = Math.min(buf.length, cut + scanWindow)
  let boundary = -1
  for (let index = cut; index < scanLimit; index += 1) {
    const byte = buf[index]
    if (byte === 0x1b) {
      boundary = index
      break
    }
    if (byte === 0x0a) {
      boundary = index + 1
      break
    }
  }
  if (boundary === -1) {
    boundary = cut
    while (boundary < buf.length) {
      const byte = buf[boundary]
      if (byte === undefined || (byte & 0xc0) !== 0x80) break
      boundary += 1
    }
  }
  return buf.subarray(boundary).toString('utf8')
}

export function capHistoryByLimits(history: string, limits: HistoryLimits): string {
  return capHistoryLines(capHistoryBytes(history, limits.maxBytes), limits.maxLines)
}

export class TerminalHistoryBuffer {
  private readonly limits: HistoryLimits
  private chunks: Array<{ text: string; bytes: number }> = []
  private totalBytes = 0
  private cached: string | null = ''

  constructor(limits: HistoryLimits) {
    this.limits = limits
  }

  static fromString(text: string, limits: HistoryLimits): TerminalHistoryBuffer {
    const buffer = new TerminalHistoryBuffer(limits)
    buffer.append(text)
    return buffer
  }

  get isEmpty(): boolean {
    return this.totalBytes === 0
  }

  get byteLength(): number {
    return this.totalBytes
  }

  append(chunk: string): void {
    if (chunk.length === 0) return
    const bytes = Buffer.byteLength(chunk, 'utf8')
    this.chunks.push({ text: chunk, bytes })
    this.totalBytes += bytes
    this.cached = null
    this.evictFront()
  }

  reset(): void {
    this.chunks = []
    this.totalBytes = 0
    this.cached = ''
  }

  private evictFront(): void {
    const { maxBytes } = this.limits
    while (this.chunks.length > 1) {
      const front = this.chunks[0]
      if (front === undefined) break
      if (this.totalBytes - front.bytes < maxBytes) break
      this.chunks.shift()
      this.totalBytes -= front.bytes
    }
  }

  toString(): string {
    if (this.cached !== null) return this.cached
    const joined =
      this.chunks.length === 1
        ? (this.chunks[0]?.text ?? '')
        : this.chunks.map(chunk => chunk.text).join('')
    const capped = capHistoryByLimits(joined, this.limits)
    if (capped.length > 0) {
      this.chunks = [{ text: capped, bytes: Buffer.byteLength(capped, 'utf8') }]
      this.totalBytes = this.chunks[0]?.bytes ?? 0
    } else {
      this.chunks = []
      this.totalBytes = 0
    }
    this.cached = capped
    return capped
  }
}
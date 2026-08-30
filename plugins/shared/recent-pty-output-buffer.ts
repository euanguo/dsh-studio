export const RECENT_PTY_OUTPUT_LIMIT = 64 * 1024
const DROPPED_HEAD_COMPACT_THRESHOLD = 1024

/**
 * Bounded deque of raw PTY output chunks retaining exactly the last
 * RECENT_PTY_OUTPUT_LIMIT UTF-16 code units (adapted from Orca's `recent-pty-output-buffer.ts`).
 *
 * Avoids rebuilding a rolling 64KB string per PTY chunk on every write.
 * Keeps chunks in a bounded array and defers the string join until requested.
 */
export class RecentPtyOutputBuffer {
  private chunks: string[] = []
  private headIndex = 0
  private headOffset = 0
  private totalLen = 0
  private headChunkIsPartial = false
  private preserveChunkBoundaries: boolean

  constructor(options?: { preserveChunkBoundaries?: boolean }) {
    this.preserveChunkBoundaries = options?.preserveChunkBoundaries ?? true
  }

  append(data: string): void {
    if (data.length === 0) return
    if (data.length >= RECENT_PTY_OUTPUT_LIMIT) {
      this.chunks = [data.slice(-RECENT_PTY_OUTPUT_LIMIT)]
      this.headIndex = 0
      this.headOffset = 0
      this.totalLen = RECENT_PTY_OUTPUT_LIMIT
      this.headChunkIsPartial = data.length > RECENT_PTY_OUTPUT_LIMIT
      return
    }
    this.chunks.push(data)
    this.totalLen += data.length
    while (this.totalLen > RECENT_PTY_OUTPUT_LIMIT) {
      const headRemaining = (this.chunks[this.headIndex]?.length ?? 0) - this.headOffset
      const excess = this.totalLen - RECENT_PTY_OUTPUT_LIMIT
      if (headRemaining <= excess) {
        this.chunks[this.headIndex] = ''
        this.headIndex += 1
        this.headOffset = 0
        this.headChunkIsPartial = false
        this.totalLen -= headRemaining
      } else {
        this.headOffset += excess
        this.totalLen -= excess
      }
    }
    if (this.headIndex >= DROPPED_HEAD_COMPACT_THRESHOLD) {
      this.chunks = this.chunks.slice(this.headIndex)
      this.headIndex = 0
    }
  }

  read(): string {
    if (this.preserveChunkBoundaries) {
      if (this.chunks.length - this.headIndex > 1) {
        const retained = this.chunks.slice(this.headIndex)
        if (this.headOffset > 0 && retained[0] !== undefined) {
          retained[0] = retained[0].slice(this.headOffset)
        }
        return retained.join('')
      }
      const head = this.chunks[this.headIndex] ?? ''
      return this.headOffset > 0 ? head.slice(this.headOffset) : head
    }
    if (this.chunks.length - this.headIndex > 1) {
      const retained = this.chunks.slice(this.headIndex)
      if (this.headOffset > 0 && retained[0] !== undefined) {
        retained[0] = retained[0].slice(this.headOffset)
        this.headOffset = 0
      }
      this.chunks = [retained.join('')]
      this.headIndex = 0
    } else if (this.headOffset > 0 && this.chunks[this.headIndex] !== undefined) {
      this.chunks[this.headIndex] = (this.chunks[this.headIndex] as string).slice(this.headOffset)
      this.headOffset = 0
    }
    return this.chunks[this.headIndex] ?? ''
  }

  compact(): void {
    this.preserveChunkBoundaries = false
    this.read()
  }

  clear(): void {
    this.chunks = []
    this.headIndex = 0
    this.headOffset = 0
    this.totalLen = 0
    this.headChunkIsPartial = false
  }
}

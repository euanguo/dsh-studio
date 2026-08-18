/**
 * Terminal output batching and flow control (ported from synara's
 * `apps/server/src/terminal/output/batching.ts`, adapted to the sidebar's
 * WebSocket protocol).
 *
 * The old implementation exposed only an isolated timer helper. This class is
 * the live boundary used by `index.ts`: PTY bytes are batched into output
 * frames, the client ACKs parsed frames, and the PTY is paused/resumed using
 * both socket-buffer and ACK watermarks. A watchdog prevents a dead renderer
 * from leaving a shell paused forever.
 */
import { randomUUID } from 'node:crypto'
import type {
  TerminalOutputAck,
  TerminalOutputFrame,
} from '@oh-dsh/shared/terminal-wire'
import {
  DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT,
  terminalOutputBacklogCapChars,
} from '@oh-dsh/shared/terminal-scrollback-policy'
export type { TerminalOutputAck, TerminalOutputFrame } from '@oh-dsh/shared/terminal-wire'

export const DEFAULT_BATCH_INTERVAL_MS = 16
export const DEFAULT_BATCH_SIZE_LIMIT = 131_072 // 128 KB
export const DEFAULT_BUFFER_HIGH_WATERMARK = terminalOutputBacklogCapChars(
  DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT,
)
export const DEFAULT_BUFFER_LOW_WATERMARK = 32_768 // 32 KB
export const DEFAULT_ACK_HIGH_WATERMARK = 100_000
export const DEFAULT_ACK_LOW_WATERMARK = 5_000
export const DEFAULT_ACK_RESUME_TIMEOUT_MS = 10_000
export const DEFAULT_SOCKET_HIGH_WATERMARK = 4 * 1024 * 1024
export const DEFAULT_SOCKET_LOW_WATERMARK = 512 * 1024

export interface PendingOutputBatch {
  readonly chunks: string[]
  readonly byteLength: number
}

export function appendOutputChunk(
  chunks: string[],
  byteLength: number,
  data: string,
): { chunks: string[]; byteLength: number } {
  chunks.push(data)
  return {
    chunks,
    byteLength: byteLength + Buffer.byteLength(data, 'utf8'),
  }
}

export function shouldFlushOutputBatch(byteLength: number, sizeLimit: number): boolean {
  return byteLength >= sizeLimit
}

export function consumeOutputBatch(
  chunks: readonly string[],
  byteLength: number,
): { data: string; byteLength: number } {
  return { data: chunks.join(''), byteLength }
}

export interface TerminalOutputBatcherOptions {
  batchIntervalMs?: number
  batchSizeLimit?: number
  bufferHighWatermark?: number
  bufferLowWatermark?: number
  ackHighWatermark?: number
  ackLowWatermark?: number
  ackResumeTimeoutMs?: number
  socketHighWatermark?: number
  socketLowWatermark?: number
  send(frame: TerminalOutputFrame): void
  bufferedAmount(): number
  pause(): void
  resume(): void
}

type UnackedFrame = { sequence: number; bytes: number }

/** One PTY-to-WebSocket output lane. One instance belongs to one socket. */
export class TerminalOutputBatcher {
  private readonly batchIntervalMs: number
  private readonly batchSizeLimit: number
  private readonly bufferHighWatermark: number
  private readonly bufferLowWatermark: number
  private readonly ackHighWatermark: number
  private readonly ackLowWatermark: number
  private readonly ackResumeTimeoutMs: number
  private readonly socketHighWatermark: number
  private readonly socketLowWatermark: number
  private epoch = randomUUID()
  private pendingChunks: string[] = []
  private pendingBytes = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private drainTimer: ReturnType<typeof setTimeout> | null = null
  private ackWatchdogTimer: ReturnType<typeof setTimeout> | null = null
  private sequence = 0
  private ackSequence = 0
  private unackedBytes = 0
  private readonly unackedFrames = new Map<number, UnackedFrame>()
  private bufferPauseRequested = false
  private ackPauseRequested = false
  private socketPauseRequested = false
  private disposed = false
  private paused = false

  constructor(options: TerminalOutputBatcherOptions) {
    this.options = options
    this.batchIntervalMs = options.batchIntervalMs ?? DEFAULT_BATCH_INTERVAL_MS
    this.batchSizeLimit = options.batchSizeLimit ?? DEFAULT_BATCH_SIZE_LIMIT
    this.bufferHighWatermark = options.bufferHighWatermark ?? DEFAULT_BUFFER_HIGH_WATERMARK
    this.bufferLowWatermark = options.bufferLowWatermark ?? DEFAULT_BUFFER_LOW_WATERMARK
    this.ackHighWatermark = options.ackHighWatermark ?? DEFAULT_ACK_HIGH_WATERMARK
    this.ackLowWatermark = options.ackLowWatermark ?? DEFAULT_ACK_LOW_WATERMARK
    this.ackResumeTimeoutMs = options.ackResumeTimeoutMs ?? DEFAULT_ACK_RESUME_TIMEOUT_MS
    this.socketHighWatermark = options.socketHighWatermark ?? DEFAULT_SOCKET_HIGH_WATERMARK
    this.socketLowWatermark = options.socketLowWatermark ?? DEFAULT_SOCKET_LOW_WATERMARK
  }

  private readonly options: TerminalOutputBatcherOptions

  get outputEpoch(): string {
    return this.epoch
  }

  get pendingOutputBytes(): number {
    return this.pendingBytes
  }

  get unackedOutputBytes(): number {
    return this.unackedBytes
  }

  append(data: string): void {
    if (this.disposed || data.length === 0) return
    const pending = appendOutputChunk(this.pendingChunks, this.pendingBytes, data)
    this.pendingChunks = pending.chunks
    this.pendingBytes = pending.byteLength
    if (this.pendingBytes >= this.bufferHighWatermark) {
      this.bufferPauseRequested = true
      this.syncPauseState()
    }
    if (shouldFlushOutputBatch(this.pendingBytes, this.batchSizeLimit)) {
      this.flush()
      return
    }
    this.scheduleFlush()
  }

  flush(): void {
    if (this.disposed) return
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.pendingChunks.length === 0) return
    if (this.socketIsTooFull()) {
      this.socketPauseRequested = true
      this.syncPauseState()
      this.scheduleDrain()
      return
    }
    const { data, byteLength } = consumeOutputBatch(this.pendingChunks, this.pendingBytes)
    this.pendingChunks = []
    this.pendingBytes = 0
    this.bufferPauseRequested = false
    if (this.options.bufferedAmount() <= this.socketLowWatermark) {
      this.socketPauseRequested = false
    }
    const frame: TerminalOutputFrame = {
      type: 'output',
      epoch: this.epoch,
      sequence: ++this.sequence,
      bytes: byteLength,
      data,
    }
    this.unackedFrames.set(frame.sequence, { sequence: frame.sequence, bytes: byteLength })
    this.unackedBytes += byteLength
    this.options.send(frame)
    if (this.unackedBytes >= this.ackHighWatermark) this.ackPauseRequested = true
    if (this.socketIsTooFull()) this.socketPauseRequested = true
    this.syncPauseState()
    if (this.pendingChunks.length > 0) this.scheduleDrain()
  }

  /**
   * Start a fresh output epoch for a renderer resync. Pending chunks are
   * dropped because the replay envelope already carries the current host
   * history/mode state; new output starts at sequence 1 after the replay frame.
   */
  resetEpoch(): void {
    if (this.disposed) return
    this.epoch = randomUUID()
    this.pendingChunks = []
    this.pendingBytes = 0
    this.sequence = 0
    this.ackSequence = 0
    this.unackedFrames.clear()
    this.unackedBytes = 0
    this.ackPauseRequested = false
    this.bufferPauseRequested = false
    this.clearAckWatchdog()
    this.syncPauseState()
  }

  acknowledge(ack: TerminalOutputAck): boolean {    if (this.disposed || ack.epoch !== this.epoch) return false
    if (!Number.isInteger(ack.sequence) || ack.sequence <= this.ackSequence || ack.sequence > this.sequence) {
      return false
    }
    if (!Number.isFinite(ack.bytes) || ack.bytes < 0) return false
    let acknowledged = 0
    let previousSequence = this.ackSequence
    const acknowledgedSequences: number[] = []
    for (const [sequence, frame] of this.unackedFrames) {
      if (sequence > ack.sequence) break
      if (sequence <= previousSequence) return false
      previousSequence = sequence
      acknowledged += frame.bytes
      acknowledgedSequences.push(sequence)
    }
    if (acknowledgedSequences.length === 0) return false
    for (const sequence of acknowledgedSequences) this.unackedFrames.delete(sequence)
    this.ackSequence = ack.sequence
    this.unackedBytes = Math.max(0, this.unackedBytes - acknowledged)
    if (this.unackedBytes <= this.ackLowWatermark) {
      this.ackPauseRequested = false
      this.clearAckWatchdog()
    }
    this.syncPauseState()
    if (this.pendingChunks.length > 0) this.flush()
    return true
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.flushTimer !== null) clearTimeout(this.flushTimer)
    if (this.drainTimer !== null) clearTimeout(this.drainTimer)
    this.clearAckWatchdog()
    this.pendingChunks = []
    this.pendingBytes = 0
    this.unackedFrames.clear()
    this.unackedBytes = 0
    if (this.paused) {
      this.paused = false
      this.options.resume()
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush()
    }, this.batchIntervalMs)
    this.unref(this.flushTimer)
  }

  private scheduleDrain(): void {
    if (this.drainTimer !== null || this.disposed) return
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null
      if (this.disposed) return
      if (!this.socketIsTooFull()) {
        this.socketPauseRequested = false
        if (this.pendingBytes <= this.bufferLowWatermark) this.bufferPauseRequested = false
        this.flush()
        this.syncPauseState()
      } else {
        this.scheduleDrain()
      }
    }, 32)
    this.unref(this.drainTimer)
  }

  private socketIsTooFull(): boolean {
    return this.options.bufferedAmount() >= this.socketHighWatermark
  }

  private syncPauseState(): void {
    const shouldPause = this.bufferPauseRequested || this.ackPauseRequested || this.socketPauseRequested
    if (shouldPause && !this.paused) {
      this.paused = true
      this.options.pause()
    } else if (!shouldPause && this.paused) {
      this.paused = false
      this.options.resume()
    }
    if (this.ackPauseRequested) this.armAckWatchdog()
  }

  private armAckWatchdog(): void {
    if (this.ackWatchdogTimer !== null) return
    this.ackWatchdogTimer = setTimeout(() => {
      this.ackWatchdogTimer = null
      if (this.disposed || !this.ackPauseRequested) return
      // The renderer may have died without closing cleanly. Drop the old ACK
      // debt and resume after the bounded watchdog rather than freezing the
      // shell forever. The next reconnect replays history from the host buffer.
      this.unackedFrames.clear()
      this.unackedBytes = 0
      this.ackSequence = this.sequence
      this.ackPauseRequested = false
      this.syncPauseState()
    }, this.ackResumeTimeoutMs)
    this.unref(this.ackWatchdogTimer)
  }

  private clearAckWatchdog(): void {
    if (this.ackWatchdogTimer === null) return
    clearTimeout(this.ackWatchdogTimer)
    this.ackWatchdogTimer = null
  }

  private unref(timer: ReturnType<typeof setTimeout>): void {
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      (timer as { unref: () => void }).unref()
    }
  }
}

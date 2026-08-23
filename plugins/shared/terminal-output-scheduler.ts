/**
 * Terminal output scheduler: queues per-terminal writes and drains them on a
 * SHARED global budget (8ms per animation-frame-style pass, per-terminal
 * caps) so one noisy PTY can't stall the renderer.
 *
 * Kept hand-written on purpose (ADR): no scheduling library (RxJS, p-queue)
 * models "one budget shared across N live terminals with per-source caps and
 * a backlog-drop chord" — RxJS buffers per stream but has no cross-stream
 * budget primitive; the custom policy is ~100 lines and unit-testable.
 */
import { terminalOutputBacklogCapChars } from './terminal-scrollback-policy.ts'

export interface TerminalOutputWriteTarget {
  write(data: string, callback?: (() => void) | undefined): void
}

export interface TerminalOutputSchedulerOptions {
  maxQueuedChars?: number
  maxQueuedChunks?: number
  parseStallTimeoutMs?: number
  onBacklogDropped?: (droppedChars: number) => void
  onParseStall?: () => void
  onWriteFailure?: (error: unknown) => void
}

export interface EnqueueTerminalOutputOptions {
  foreground?: boolean
}

type QueuedOutput = {
  data: string
  bytes: number
  acknowledge?: (() => void) | undefined
}

const GLOBAL_DRAIN_BUDGET_MS = 8
const MAX_WRITES_PER_TERMINAL_PER_DRAIN = 2
const MAX_CHARS_PER_TERMINAL_PER_DRAIN = 128 * 1024
const DEFAULT_MAX_QUEUED_CHUNKS = 4_096
const DEFAULT_PARSE_STALL_TIMEOUT_MS = 250

const activeSchedulers = new Set<TerminalOutputScheduler>()
let drainTimer: ReturnType<typeof setTimeout> | null = null
let drainRunning = false

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function scheduleGlobalDrain(): void {
  if (drainTimer !== null || drainRunning || activeSchedulers.size === 0) return
  drainTimer = setTimeout(() => {
    drainTimer = null
    drainGlobalQueue()
  }, 0)
}

function drainGlobalQueue(): void {
  if (drainRunning) return
  drainRunning = true
  const startedAt = now()
  try {
    const schedulers = [...activeSchedulers]
    let madeProgress = true
    while (madeProgress && activeSchedulers.size > 0 && now() - startedAt < GLOBAL_DRAIN_BUDGET_MS) {
      madeProgress = false
      for (const scheduler of schedulers) {
        if (!activeSchedulers.has(scheduler)) continue
        if (now() - startedAt >= GLOBAL_DRAIN_BUDGET_MS) break
        madeProgress = scheduler.drainSome() || madeProgress
      }
    }
  } finally {
    drainRunning = false
  }
  if (activeSchedulers.size > 0) scheduleGlobalDrain()
}

function settleAcknowledgement(acknowledge: (() => void) | undefined): void {
  try {
    acknowledge?.()
  } catch {
    // ACK callbacks are transport bookkeeping; a callback failure must not
    // prevent remaining queued chunks from being released.
  }
}

/**
 * Fair renderer output scheduler for all xterm instances in one client.
 *
 * Interface invariant: every enqueued chunk is either parsed by xterm or
 * settled as discarded exactly once. Queue limits are lossy by design so a
 * backgrounded renderer cannot grow without bound while PTYs keep writing.
 */
export class TerminalOutputScheduler {
  private readonly terminal: TerminalOutputWriteTarget
  private readonly foreground: QueuedOutput[] = []
  private readonly background: QueuedOutput[] = []
  private readonly maxQueuedChars: number
  private readonly maxQueuedChunks: number
  private readonly parseStallTimeoutMs: number
  private queuedChars = 0
  private disposed = false
  private dead = false
  private draining = false
  private foregroundTurn = true

  constructor(
    terminal: TerminalOutputWriteTarget,
    options: TerminalOutputSchedulerOptions = {},
  ) {
    this.terminal = terminal
    this.maxQueuedChars = options.maxQueuedChars ?? terminalOutputBacklogCapChars(5_000)
    this.maxQueuedChunks = options.maxQueuedChunks ?? DEFAULT_MAX_QUEUED_CHUNKS
    this.parseStallTimeoutMs = options.parseStallTimeoutMs ?? DEFAULT_PARSE_STALL_TIMEOUT_MS
    this.onBacklogDropped = options.onBacklogDropped
    this.onParseStall = options.onParseStall
    this.onWriteFailure = options.onWriteFailure
  }

  private readonly onBacklogDropped: ((droppedChars: number) => void) | undefined
  private readonly onParseStall: (() => void) | undefined
  private readonly onWriteFailure: ((error: unknown) => void) | undefined

  get queuedCharCount(): number {
    return this.queuedChars
  }

  /** Byte-accurate queue size used by flow-control diagnostics. */
  get queuedByteCount(): number {
    return this.queuedChars
  }

  get isDead(): boolean {
    return this.dead
  }

  enqueue(
    data: string,
    acknowledge?: () => void,
    options: EnqueueTerminalOutputOptions = {},
  ): void {
    if (data.length === 0) {
      settleAcknowledgement(acknowledge)
      return
    }
    if (this.disposed || this.dead) {
      settleAcknowledgement(acknowledge)
      return
    }
    const entry = { data, bytes: utf8ByteLength(data), acknowledge }
    if (options.foreground === false) this.background.push(entry)
    else this.foreground.push(entry)
    this.queuedChars += entry.bytes
    this.enforceQueueCaps()
    activeSchedulers.add(this)
    scheduleGlobalDrain()
  }

  /** Synchronously drain the scheduler; primarily useful for deterministic tests. */
  drainNow(): void {
    drainGlobalQueue()
  }

  reset(): void {
    if (this.disposed) return
    this.discardQueued()
    this.dead = false
    this.draining = false
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.discardQueued()
    activeSchedulers.delete(this)
  }

  private totalQueuedChunks(): number {
    return this.foreground.length + this.background.length
  }

  private enforceQueueCaps(): void {
    if (this.queuedChars <= this.maxQueuedChars && this.totalQueuedChunks() <= this.maxQueuedChunks) return
    let droppedChars = 0
    while (
      (this.queuedChars > this.maxQueuedChars || this.totalQueuedChunks() > this.maxQueuedChunks)
      && this.background.length > 0
    ) {
      const entry = this.background.shift()
      if (!entry) break
      droppedChars += entry.bytes
      this.queuedChars -= entry.bytes
      settleAcknowledgement(entry.acknowledge)
    }
    // A visible terminal can still be starved by a pathological burst. Drop
    // oldest foreground chunks only after background output is exhausted.
    while (
      (this.queuedChars > this.maxQueuedChars || this.totalQueuedChunks() > this.maxQueuedChunks)
      && this.foreground.length > 0
    ) {
      const entry = this.foreground.shift()
      if (!entry) break
      droppedChars += entry.bytes
      this.queuedChars -= entry.bytes
      settleAcknowledgement(entry.acknowledge)
    }
    if (droppedChars > 0) this.onBacklogDropped?.(droppedChars)
    if (this.totalQueuedChunks() === 0) activeSchedulers.delete(this)
  }

  private nextEntry(): QueuedOutput | undefined {
    if (this.foreground.length === 0 && this.background.length === 0) return undefined
    if (this.foregroundTurn && this.foreground.length > 0) {
      this.foregroundTurn = false
      return this.foreground.shift()
    }
    if (this.background.length > 0) {
      this.foregroundTurn = true
      return this.background.shift()
    }
    this.foregroundTurn = true
    return this.foreground.shift()
  }

  /** Drain one terminal's next write; used by the global fair scheduler. */
  drainSome(): boolean {
    if (this.disposed || this.dead || this.draining) return false
    this.draining = true
    let madeProgress = false
    let writes = 0
    let chars = 0
    try {
      while (
        writes < MAX_WRITES_PER_TERMINAL_PER_DRAIN
        && chars < MAX_CHARS_PER_TERMINAL_PER_DRAIN
      ) {
        const entry = this.nextEntry()
        if (!entry) break
        this.queuedChars -= entry.bytes
        writes += 1
        chars += entry.bytes
        madeProgress = true
        this.writeEntry(entry)
      }
    } finally {
      this.draining = false
    }
    if (this.totalQueuedChunks() === 0) activeSchedulers.delete(this)
    return madeProgress
  }

  private writeEntry(entry: QueuedOutput): void {
    let settled = false
    const settle = (): void => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      settleAcknowledgement(entry.acknowledge)
    }
    const timer = setTimeout(() => {
      if (settled || this.disposed || this.dead) return
      settled = true
      clearTimeout(timer)
      this.dead = true
      settleAcknowledgement(entry.acknowledge)
      this.discardQueued()
      activeSchedulers.delete(this)
      this.onParseStall?.()
    }, this.parseStallTimeoutMs)
    try {
      this.terminal.write(entry.data, settle)
    } catch (error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      settleAcknowledgement(entry.acknowledge)
      this.dead = true
      this.discardQueued()
      activeSchedulers.delete(this)
      this.onWriteFailure?.(error)
    }
  }

  private discardQueued(): void {
    for (const entry of [...this.foreground, ...this.background]) {
      settleAcknowledgement(entry.acknowledge)
    }
    this.foreground.length = 0
    this.background.length = 0
    this.queuedChars = 0
  }
}

const sharedTextEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null

function utf8ByteLength(value: string): number {
  if (value.length === 0) return 0
  // Fast-path for pure ASCII strings (common case in terminal output):
  let isAscii = true
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 127) {
      isAscii = false
      break
    }
  }
  if (isAscii) return value.length
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(value, 'utf8')
  if (sharedTextEncoder !== null) return sharedTextEncoder.encode(value).byteLength
  return value.length
}

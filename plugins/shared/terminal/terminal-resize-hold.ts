export interface TerminalDimensions {
  cols: number
  rows: number
}

export interface TerminalResizeHoldScheduler {
  schedule(callback: () => void): unknown
  scheduleAfter(callback: () => void, delayMs: number): unknown
  cancel(handle: unknown): void
  now(): number
}

const DEFAULT_SCHEDULER: TerminalResizeHoldScheduler = {
  schedule: callback => setTimeout(callback, 0),
  scheduleAfter: (callback, delayMs) => setTimeout(callback, Math.max(0, delayMs)),
  cancel: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
  now: () => Date.now(),
}

/**
 * Coalesces PTY resize requests and supports explicit structural-layout holds.
 * During a hold only the final dimensions are retained; without a hold a burst
 * is still reduced to one request per scheduler turn, avoiding SIGWINCH storms.
 *
 * `minIntervalMs` additionally rate-limits the APPLIED stream: consecutive
 * applies are spaced at least `minIntervalMs` apart, so a live drag (which
 * emits a resize per frame) cannot push a resize per animation frame into the
 * shell. The latest dimensions always win — a deferred request is re-deferred
 * to the rate-cap boundary, never dropped.
 */
export class TerminalResizeHold {
  private readonly apply: (dimensions: TerminalDimensions) => void
  private readonly scheduler: TerminalResizeHoldScheduler
  private readonly minIntervalMs: number
  private depth = 0
  private pending: TerminalDimensions | null = null
  private scheduled: unknown = null
  private applied: TerminalDimensions | null = null
  private lastAppliedAt = 0
  private disposed = false

  constructor(
    apply: (dimensions: TerminalDimensions) => void,
    scheduler: TerminalResizeHoldScheduler = DEFAULT_SCHEDULER,
    minIntervalMs = 0,
  ) {
    this.apply = apply
    this.scheduler = scheduler
    this.minIntervalMs = Math.max(0, minIntervalMs)
    // The first request applies immediately: treat the interval as already
    // elapsed (a zero interval keeps this exact).
    this.lastAppliedAt = -this.minIntervalMs
  }

  begin(): void {
    if (!this.disposed) this.depth += 1
  }

  request(dimensions: TerminalDimensions): void {
    if (this.disposed) return
    const next = normalizeDimensions(dimensions)
    if (this.applied !== null && sameDimensions(this.applied, next)) return
    this.pending = next
    if (this.depth > 0 || this.scheduled !== null) return
    this.scheduleFlush()
  }

  end(): void {
    if (this.disposed || this.depth === 0) return
    this.depth -= 1
    if (this.depth === 0) {
      if (this.scheduled !== null) {
        this.scheduler.cancel(this.scheduled)
        this.scheduled = null
      }
      this.flush()
    }
  }

  cancel(): void {
    if (this.scheduled !== null) this.scheduler.cancel(this.scheduled)
    this.scheduled = null
    this.pending = null
    this.depth = 0
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancel()
  }

  get isHolding(): boolean {
    return this.depth > 0
  }

  get pendingDimensions(): TerminalDimensions | null {
    return this.pending === null ? null : { ...this.pending }
  }

  private scheduleFlush(): void {
    const wait = Math.max(
      0,
      this.minIntervalMs - (this.scheduler.now() - this.lastAppliedAt),
    )
    this.scheduled = wait > 0
      ? this.scheduler.scheduleAfter(() => {
          this.scheduled = null
          this.flush()
        }, wait)
      : this.scheduler.schedule(() => {
          this.scheduled = null
          this.flush()
        })
  }

  private flush(): void {
    const next = this.pending
    this.pending = null
    if (next === null || this.disposed) return
    if (this.depth > 0) {
      // A hold is still active (e.g. end() raced a re-entrant request):
      // keep the latest dimensions until the hold actually releases.
      this.pending = next
      return
    }
    if (this.applied !== null && sameDimensions(this.applied, next)) return
    const wait = this.minIntervalMs - (this.scheduler.now() - this.lastAppliedAt)
    if (wait > 0) {
      // Inside the rate-cap window: defer to the boundary, keeping the
      // latest dimensions (never dropping a resize that is still desired).
      this.pending = next
      if (this.scheduled === null) this.scheduleFlush()
      return
    }
    this.applied = next
    this.lastAppliedAt = this.scheduler.now()
    this.apply(next)
  }
}

function normalizeDimensions(dimensions: TerminalDimensions): TerminalDimensions {
  return {
    cols: Math.max(2, Math.floor(dimensions.cols)),
    rows: Math.max(2, Math.floor(dimensions.rows)),
  }
}

function sameDimensions(left: TerminalDimensions, right: TerminalDimensions): boolean {
  return left.cols === right.cols && left.rows === right.rows
}

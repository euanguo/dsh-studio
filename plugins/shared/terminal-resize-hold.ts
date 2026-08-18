export interface TerminalDimensions {
  cols: number
  rows: number
}

export interface TerminalResizeHoldScheduler {
  schedule(callback: () => void): unknown
  cancel(handle: unknown): void
}

const DEFAULT_SCHEDULER: TerminalResizeHoldScheduler = {
  schedule: callback => setTimeout(callback, 0),
  cancel: handle => { clearTimeout(handle as ReturnType<typeof setTimeout>) },
}

/**
 * Coalesces PTY resize requests and supports explicit structural-layout holds.
 * During a hold only the final dimensions are retained; without a hold a burst
 * is still reduced to one request per scheduler turn, avoiding SIGWINCH storms.
 */
export class TerminalResizeHold {
  private readonly apply: (dimensions: TerminalDimensions) => void
  private readonly scheduler: TerminalResizeHoldScheduler
  private depth = 0
  private pending: TerminalDimensions | null = null
  private scheduled: unknown = null
  private applied: TerminalDimensions | null = null
  private disposed = false

  constructor(
    apply: (dimensions: TerminalDimensions) => void,
    scheduler: TerminalResizeHoldScheduler = DEFAULT_SCHEDULER,
  ) {
    this.apply = apply
    this.scheduler = scheduler
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
    this.scheduled = this.scheduler.schedule(() => {
      this.scheduled = null
      if (this.depth === 0) this.flush()
    })
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

  private flush(): void {
    const next = this.pending
    this.pending = null
    if (next === null || this.disposed) return
    if (this.applied !== null && sameDimensions(this.applied, next)) return
    this.applied = next
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

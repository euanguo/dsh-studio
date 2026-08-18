/**
 * Keyed async recovery coordinator with generation-gated retry and exponential
 * backoff + jitter (ported from synara's `apps/server/src/terminal/terminalRecoveryCoordinator.ts`).
 *
 * Prevents concurrent reconnect storms, cancels stale retry loops on generation
 * bump, and applies backoff with jitter (250ms to 30s). Zero external dependencies.
 */

export type TerminalRecoveryErrorKind = 'permanent' | 'retryable'

export interface TerminalRecoveryCoordinatorOptions<Input> {
  recover: (input: Input) => Promise<void>
  classifyError: (error: unknown) => TerminalRecoveryErrorKind
  onPermanentFailure: (input: Input, error: unknown) => void
  onRetry?: (input: Input, error: unknown, attempt: number, delayMs: number) => void
  baseDelayMs?: number
  maxDelayMs?: number
  random?: () => number
}

interface PendingRecovery<Input> {
  readonly input: Input
  readonly generation: number
  attempt: number
  timer: ReturnType<typeof setTimeout> | null
  running: boolean
  readonly completion: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
}

export class TerminalRecoveryCoordinator<Input> {
  private readonly options: TerminalRecoveryCoordinatorOptions<Input>
  private readonly pending = new Map<string, PendingRecovery<Input>>()
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly random: () => number
  private disposed = false

  constructor(options: TerminalRecoveryCoordinatorOptions<Input>) {
    this.options = options
    this.baseDelayMs = options.baseDelayMs ?? 250
    this.maxDelayMs = options.maxDelayMs ?? 30_000
    this.random = options.random ?? Math.random
  }

  schedule(key: string, input: Input, generation: number): void {
    void this.ensure(key, input, generation).catch(() => undefined)
  }

  ensure(key: string, input: Input, generation: number): Promise<void> {
    if (this.disposed) {
      return Promise.reject(new Error('Terminal recovery coordinator is disposed'))
    }
    const current = this.pending.get(key)
    if (current?.generation === generation) {
      if (!current.running && !current.timer) this.scheduleAttempt(key, current, 0)
      return current.completion
    }
    if (current) {
      if (current.timer) clearTimeout(current.timer)
      current.reject(new Error('Terminal recovery generation was replaced'))
    }
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const completion = new Promise<void>((resolveCompletion, rejectCompletion) => {
      resolve = resolveCompletion
      reject = rejectCompletion
    })
    const next: PendingRecovery<Input> = {
      input,
      generation,
      attempt: 0,
      timer: null,
      running: false,
      completion,
      resolve,
      reject,
    }
    this.pending.set(key, next)
    this.scheduleAttempt(key, next, 0)
    return completion
  }

  cancel(key: string): void {
    const current = this.pending.get(key)
    if (current?.timer) clearTimeout(current.timer)
    current?.reject(new Error('Terminal recovery was cancelled'))
    this.pending.delete(key)
  }

  isPending(key: string): boolean {
    return this.pending.has(key)
  }

  dispose(): void {
    this.disposed = true
    for (const recovery of this.pending.values()) {
      if (recovery.timer) clearTimeout(recovery.timer)
      recovery.reject(new Error('Terminal recovery coordinator was disposed'))
    }
    this.pending.clear()
  }

  private scheduleAttempt(key: string, recovery: PendingRecovery<Input>, delayMs: number): void {
    const run = (): void => {
      recovery.timer = null
      void this.runAttempt(key, recovery)
    }
    if (delayMs === 0) {
      run()
      return
    }
    recovery.timer = setTimeout(run, delayMs)
    if (typeof recovery.timer === 'object' && recovery.timer !== null && 'unref' in recovery.timer) {
      (recovery.timer as { unref: () => void }).unref()
    }
  }

  private async runAttempt(key: string, recovery: PendingRecovery<Input>): Promise<void> {
    if (this.disposed || this.pending.get(key) !== recovery || recovery.running) return
    recovery.running = true
    try {
      await this.options.recover(recovery.input)
      if (this.pending.get(key) === recovery) {
        this.pending.delete(key)
        recovery.resolve()
      }
    } catch (error) {
      if (this.pending.get(key) !== recovery) return
      if (this.options.classifyError(error) === 'permanent') {
        this.pending.delete(key)
        this.options.onPermanentFailure(recovery.input, error)
        recovery.reject(error)
        return
      }
      recovery.attempt += 1
      const delayMs = this.retryDelay(recovery.attempt)
      this.options.onRetry?.(recovery.input, error, recovery.attempt, delayMs)
      this.scheduleAttempt(key, recovery, delayMs)
    } finally {
      recovery.running = false
    }
  }

  private retryDelay(attempt: number): number {
    const exponential = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** (attempt - 1))
    const jitter = 0.75 + this.random() * 0.5
    return Math.max(1, Math.round(exponential * jitter))
  }
}
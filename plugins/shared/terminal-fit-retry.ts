const MAX_RETRY_FRAMES = 40
const LAYOUT_SETTLE_MS = 16

type RetrySchedule = { cancel: () => void }

type RetryState = {
  attempts: number
  schedule: RetrySchedule | null
  retry: () => boolean
  onExhausted: (() => void) | undefined
}

const retryMap = new Map<object, RetryState>()

function scheduleRetryTick(run: () => void): RetrySchedule {
  if (typeof requestAnimationFrame === 'function') {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const rafId = requestAnimationFrame(() => {
      if (!cancelled) {
        timer = setTimeout(run, LAYOUT_SETTLE_MS)
      }
    })
    return {
      cancel: () => {
        cancelled = true
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafId)
        }
        if (timer !== null) {
          clearTimeout(timer)
        }
      },
    }
  }
  const timer = setTimeout(run, LAYOUT_SETTLE_MS)
  return { cancel: () => clearTimeout(timer) }
}

export function clearTerminalFitContinuationRetry(target: object): void {
  const state = retryMap.get(target)
  if (!state) return
  retryMap.delete(target)
  state.schedule?.cancel()
  state.schedule = null
}

export function armTerminalFitContinuationRetry(
  target: object,
  callbacks: { retry: () => boolean; onExhausted?: () => void },
): void {
  const state = retryMap.get(target) ?? {
    attempts: 0,
    schedule: null,
    retry: callbacks.retry,
    onExhausted: callbacks.onExhausted,
  }
  state.retry = callbacks.retry
  state.onExhausted = callbacks.onExhausted
  retryMap.set(target, state)
  if (state.schedule) return

  state.schedule = scheduleRetryTick(() => {
    state.schedule = null
    if (state.retry()) {
      clearTerminalFitContinuationRetry(target)
      return
    }
    state.attempts += 1
    if (state.attempts >= MAX_RETRY_FRAMES) {
      clearTerminalFitContinuationRetry(target)
      state.onExhausted?.()
      return
    }
    armTerminalFitContinuationRetry(target, callbacks)
  })
}

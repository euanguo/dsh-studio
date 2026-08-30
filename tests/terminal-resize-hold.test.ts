import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TerminalResizeHold } from '../plugins/shared/terminal/terminal-resize-hold.ts'

function scheduler() {
  const callbacks: Array<() => void> = []
  let now = 0
  return {
    callbacks,
    schedule(callback: () => void): number {
      callbacks.push(callback)
      return callbacks.length - 1
    },
    scheduleAfter(callback: () => void): number {
      callbacks.push(callback)
      return callbacks.length - 1
    },
    cancel(handle: unknown): void {
      callbacks[Number(handle)] = () => {}
    },
    now(): number {
      return now
    },
    advance(ms: number): void {
      now += ms
    },
    flush(): void {
      const next = callbacks.splice(0)
      for (const callback of next) callback()
    },
  }
}

test('resize hold coalesces a burst to the latest dimensions', () => {
  const clock = scheduler()
  const applied: Array<{ cols: number; rows: number }> = []
  const hold = new TerminalResizeHold(value => { applied.push(value) }, clock)
  hold.request({ cols: 80, rows: 24 })
  hold.request({ cols: 100, rows: 30 })
  assert.deepEqual(applied, [])
  clock.flush()
  assert.deepEqual(applied, [{ cols: 100, rows: 30 }])
})

test('resize hold delays structural changes until end and skips duplicates', () => {
  const clock = scheduler()
  const applied: Array<{ cols: number; rows: number }> = []
  const hold = new TerminalResizeHold(value => { applied.push(value) }, clock)
  hold.begin()
  hold.request({ cols: 80.8, rows: 24.9 })
  hold.request({ cols: 120, rows: 40 })
  clock.flush()
  assert.deepEqual(applied, [])
  hold.end()
  assert.deepEqual(applied, [{ cols: 120, rows: 40 }])
  hold.request({ cols: 120, rows: 40 })
  clock.flush()
  assert.deepEqual(applied, [{ cols: 120, rows: 40 }])
})

test('resize hold rate-limits applied resizes to the minimum interval', () => {
  const clock = scheduler()
  const applied: Array<{ cols: number; rows: number }> = []
  const hold = new TerminalResizeHold(value => { applied.push(value) }, clock, 50)
  // First request applies immediately (no prior apply inside the window).
  hold.request({ cols: 80, rows: 24 })
  clock.flush()
  assert.deepEqual(applied, [{ cols: 80, rows: 24 }])
  // A burst inside the 50ms window is deferred, never applied per frame.
  hold.request({ cols: 90, rows: 26 })
  clock.flush()
  assert.deepEqual(applied, [{ cols: 80, rows: 24 }])
  clock.advance(49)
  hold.request({ cols: 100, rows: 30 })
  clock.flush()
  assert.deepEqual(applied, [{ cols: 80, rows: 24 }])
  // Past the boundary the LATEST dimensions apply (nothing was dropped).
  clock.advance(1)
  clock.flush()
  assert.deepEqual(applied, [{ cols: 80, rows: 24 }, { cols: 100, rows: 30 }])
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TerminalResizeHold } from '../plugins/shared/terminal-resize-hold.ts'

function scheduler() {
  const callbacks: Array<() => void> = []
  return {
    callbacks,
    schedule(callback: () => void): number {
      callbacks.push(callback)
      return callbacks.length - 1
    },
    cancel(handle: unknown): void {
      callbacks[Number(handle)] = () => {}
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

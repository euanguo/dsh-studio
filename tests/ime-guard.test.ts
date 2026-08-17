import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isImeComposition,
  registerImeGuard,
} from '../plugins/sidebar/src/client/ime-guard.ts'

test('isImeComposition treats isComposing as composition', () => {
  assert.equal(isImeComposition({ isComposing: true, keyCode: 0 }), true)
})

test('isImeComposition treats keyCode 229 as composition (legacy engines)', () => {
  assert.equal(isImeComposition({ isComposing: false, keyCode: 229 }), true)
})

test('isImeComposition treats both signals together as composition', () => {
  assert.equal(isImeComposition({ isComposing: true, keyCode: 229 }), true)
})

test('isImeComposition lets ordinary keys through', () => {
  assert.equal(isImeComposition({ isComposing: false, keyCode: 40 }), false)
  assert.equal(isImeComposition({ isComposing: false, keyCode: 0 }), false)
})

/* ── register/dispose mechanics against a minimal document stub ────────── */

interface StubListener {
  type: string
  handler: (event: KeyboardEvent) => void
  capture: boolean
}

function installDocumentStub(): {
  listeners: StubListener[]
  restore(): void
  dispatch(
    type: 'keydown' | 'keyup',
    event: Partial<KeyboardEvent> & { isComposing?: boolean; keyCode?: number },
  ): KeyboardEvent & { stopPropagationCalls: number }
} {
  const listeners: StubListener[] = []
  const documentStub = {
    addEventListener: (type: string, handler: (event: KeyboardEvent) => void, capture: boolean): void => {
      listeners.push({ type, handler, capture })
    },
    removeEventListener: (type: string, handler: (event: KeyboardEvent) => void, capture: boolean): void => {
      const index = listeners.findIndex(
        entry => entry.type === type && entry.handler === handler && entry.capture === capture,
      )
      if (index !== -1) listeners.splice(index, 1)
    },
  }
  const original: unknown = (globalThis as Record<string, unknown>).document
  ;(globalThis as Record<string, unknown>).document = documentStub
  return {
    listeners,
    restore: () => {
      ;(globalThis as Record<string, unknown>).document = original
    },
    dispatch: (type, init) => {
      const event = {
        isComposing: init.isComposing ?? false,
        keyCode: init.keyCode ?? 0,
        stopPropagationCalls: 0,
        stopPropagation() { this.stopPropagationCalls += 1 },
      } as KeyboardEvent & { stopPropagationCalls: number }
      for (const entry of listeners) {
        if (entry.type !== type) continue
        entry.handler(event)
      }
      return event
    },
  }
}

test('registerImeGuard installs capture-phase keydown+keyup listeners and blocks composition keys', () => {
  const stub = installDocumentStub()
  try {
    const dispose = registerImeGuard()
    assert.equal(stub.listeners.length, 2)
    assert.deepEqual(
      stub.listeners.map(entry => ({ type: entry.type, capture: entry.capture })),
      [
        { type: 'keydown', capture: true },
        { type: 'keyup', capture: true },
      ],
    )
    // Composition keys are stopped in the capture phase (no propagation).
    const keydown = stub.dispatch('keydown', { isComposing: true })
    assert.equal(keydown.stopPropagationCalls, 1)
    const keyup = stub.dispatch('keyup', { keyCode: 229 })
    assert.equal(keyup.stopPropagationCalls, 1)
    // Ordinary keys pass through untouched.
    const arrow = stub.dispatch('keydown', { isComposing: false, keyCode: 40 })
    assert.equal(arrow.stopPropagationCalls, 0)
    // Disposer removes both listeners (HMR-safe).
    dispose()
    assert.equal(stub.listeners.length, 0)
  } finally {
    stub.restore()
  }
})
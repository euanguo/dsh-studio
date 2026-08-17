import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ensureStyle } from '../plugins/shared/style-injector.ts'

/**
 * Minimal document/head stubs for node:test (no jsdom): the injector only
 * needs createElement, head.append/remove, isConnected, and MutationObserver
 * callbacks, which we drive by hand.
 */
class StyleElement {
  textContent = ''
  readonly dataset: Record<string, string> = {}
  isConnected = false
  parentElement: HeadElement | null = null
  remove(): void {
    this.isConnected = false
    this.parentElement?.children.delete(this)
    this.parentElement = null
  }
}

class HeadElement {
  readonly children = new Set<StyleElement>()
  append(child: StyleElement): void {
    this.children.add(child)
    child.isConnected = true
    child.parentElement = this
  }
}

interface ObserverRecord {
  removedNodes: Node[]
}

function stubDocument(): {
  head: HeadElement
  observers: Array<{ callback: (records: ObserverRecord[]) => void; disconnected: boolean }>
} {
  const head = new HeadElement()
  const observers: Array<{ callback: (records: ObserverRecord[]) => void; disconnected: boolean }> = []
  const globalAny = globalThis as unknown as {
    document?: unknown
    MutationObserver?: unknown
  }
  globalAny.document = {
    createElement: () => new StyleElement(),
    head,
  }
  globalAny.MutationObserver = class {
    readonly callback: (records: ObserverRecord[]) => void
    disconnected = false
    constructor(callback: (records: ObserverRecord[]) => void) {
      this.callback = callback
      // The live instance itself, so disconnect() is observable here.
      observers.push(this)
    }
    observe(): void { /* stub: driven by hand */ }
    disconnect(): void { this.disconnected = true }
  }
  return { head, observers }
}

test('ensureStyle is idempotent per id and refreshes changed css', () => {
  const { head } = stubDocument()
  const disposeFirst = ensureStyle('test-a', 'a{color:red}')
  assert.equal(head.children.size, 1)
  const element = [...head.children][0]!
  assert.equal(element.dataset.ohDshStyle, 'test-a')
  assert.equal(element.textContent, 'a{color:red}')

  // A second ensure with the same id reuses the element (no duplicate) and
  // refreshes the css — the HMR remount path.
  const disposeSecond = ensureStyle('test-a', 'a{color:blue}')
  assert.equal(head.children.size, 1)
  assert.equal(element.textContent, 'a{color:blue}')

  // One id, one mount: either disposer unmounts it (no refcounting — every
  // consumer owns exactly one mount/dismount pair).
  disposeFirst()
  assert.equal(head.children.size, 0)
  disposeSecond()
  assert.equal(head.children.size, 0)
})

test('ensureStyle heals a removed element while live', () => {
  const { head, observers } = stubDocument()
  const dispose = ensureStyle('test-heal', 'b{}')
  const element = [...head.children][0]!
  assert.equal(element.isConnected, true)

  // Simulate DSH hot-reload stripping the style from head.
  element.remove()
  assert.equal(element.isConnected, false)
  const live = observers.find(observer => !observer.disconnected)
  assert.notEqual(live, undefined, 'a healing observer is attached')
  live!.callback([{ removedNodes: [element as unknown as Node] }])
  assert.equal(element.isConnected, true, 'the element is re-appended')
  assert.equal(head.children.size, 1)

  dispose()
  assert.equal(head.children.size, 0)
  assert.equal(
    observers.every(observer => observer.disconnected),
    true,
    'the observer stops after dispose',
  )
})

test('a disposed style does not heal back', () => {
  const { head, observers } = stubDocument()
  const dispose = ensureStyle('test-gone', 'c{}')
  const element = [...head.children][0]!
  dispose()
  const afterDispose = [...observers]
  element.remove()
  // Any straggler observer callback must not resurrect the element.
  for (const observer of afterDispose) {
    if (!observer.disconnected) observer.callback([{ removedNodes: [element as unknown as Node] }])
  }
  assert.equal(element.isConnected, false, 'a disposed style stays gone')
  assert.equal(head.children.size, 0)
})

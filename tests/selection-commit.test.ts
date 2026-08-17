/**
 * Tests for the selection-commit and shadow-boundary helpers extracted for
 * the selection → "add to conversation" channel:
 *
 * - `containsNodeAcrossShadow` — containment across open shadow roots
 *   (the Pierre viewers render their rows in one, where the plain
 *   `Node.contains` is always false for the selection's common ancestor).
 * - `afterSelectionCommit` — two-frame rAF wait so a mouseup handler reads
 *   the selection AFTER the browser commits it.
 * - `mutationNeedsMount` — the self-healing column-mount observer filter
 *   (shared by the terminal dock and the bottom workbench).
 *
 * These run under node:test without jsdom, so the DOM shape is stubbed
 * with plain object graphs.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  afterSelectionCommit,
  containsNodeAcrossShadow,
} from '../plugins/sidebar/src/client/files/file-selection-reference.ts'
import { mutationNeedsMount } from '../plugins/shared/column-mount.ts'

/* ---------- DOM stubs ---------- */

class StubShadowRoot {
  readonly host: Node
  constructor(host: Node) { this.host = host }
}

// `containsNodeAcrossShadow` gates on the real `ShadowRoot` global; the
// stub must BE the global for the `instanceof` check to see it.
;(globalThis as { ShadowRoot?: unknown }).ShadowRoot = StubShadowRoot

/** A container stub that "contains" exactly the nodes in its set. */
function containerWith(contained: readonly Node[]): Node {
  const set = new Set(contained)
  return {
    contains: (n: Node): boolean => set.has(n),
  } as unknown as Node
}

/** A light-DOM node (getRootNode returns itself, i.e. a Document). */
function lightNode(): Node {
  const node = {} as Node
  return Object.assign(node, { getRootNode: () => node })
}

/** A shadow-internal node whose root is a shadow root hosted by `host`. */
function shadowNode(host: Node): Node {
  return {
    getRootNode: () => new StubShadowRoot(host),
  } as unknown as Node
}

test('containsNodeAcrossShadow: plain light-DOM containment', () => {
  const inside = lightNode()
  const outside = lightNode()
  const container = containerWith([inside])
  assert.equal(containsNodeAcrossShadow(container, inside), true)
  assert.equal(containsNodeAcrossShadow(container, outside), false)
  // The container itself counts as "inside".
  assert.equal(containsNodeAcrossShadow(container, container), true)
})

test('containsNodeAcrossShadow: climbs one shadow boundary via the host', () => {
  const host = lightNode()
  const container = containerWith([host])
  const inner = shadowNode(host)
  assert.equal(containsNodeAcrossShadow(container, inner), true)
})

test('containsNodeAcrossShadow: false when the shadow host is outside', () => {
  const host = lightNode()
  const container = containerWith([])
  const inner = shadowNode(host)
  assert.equal(containsNodeAcrossShadow(container, inner), false)
})

test('containsNodeAcrossShadow: nested shadow roots climb all the way', () => {
  const outerHost = lightNode()
  const container = containerWith([outerHost])
  const innerHost = shadowNode(outerHost)
  const deepNode = shadowNode(innerHost)
  assert.equal(containsNodeAcrossShadow(container, deepNode), true)
})

/* ---------- afterSelectionCommit ---------- */

test('afterSelectionCommit: fires after two rAF ticks with the selection', () => {
  const original = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  const queued: Array<() => void> = []
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
    queued.push(cb as () => void)
    return queued.length
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
  const selection = { fake: true } as unknown as Selection
  const originalGetSelection = globalThis.getSelection
  globalThis.getSelection = () => selection
  try {
    let delivered: Selection | null = null
    afterSelectionCommit(value => { delivered = value })
    // First tick only queues the second; nothing delivered yet.
    queued[0]?.()
    assert.equal(delivered, null)
    queued[1]?.()
    assert.equal(delivered, selection)
  } finally {
    globalThis.requestAnimationFrame = original
    globalThis.cancelAnimationFrame = originalCancel
    if (originalGetSelection === undefined) globalThis.getSelection = () => null
    else globalThis.getSelection = originalGetSelection
  }
})

test('afterSelectionCommit: the canceller drops a pending read', () => {
  const original = globalThis.requestAnimationFrame
  const originalCancel = globalThis.cancelAnimationFrame
  const queued: Array<() => void> = []
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
    queued.push(cb as () => void)
    return queued.length
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
  try {
    let delivered = false
    const cancel = afterSelectionCommit(() => { delivered = true })
    cancel()
    queued[0]?.()
    queued[1]?.()
    assert.equal(delivered, false)
  } finally {
    globalThis.requestAnimationFrame = original
    globalThis.cancelAnimationFrame = originalCancel
  }
})

/* ---------- mutationNeedsMount ---------- */

function mutationRecord(shape: Partial<MutationRecord>): MutationRecord {
  return shape as MutationRecord
}

test('mutationNeedsMount: ignores the owned root subtree', () => {
  const owned = {
    nodeType: 1,
    matches: (selector: string): boolean => selector === '#oh-dsh-owned-root',
    parentNode: null,
  } as unknown as Element
  const childListInside = mutationRecord({
    type: 'childList',
    target: owned,
    addedNodes: [] as unknown as NodeList,
    removedNodes: [] as unknown as NodeList,
  })
  assert.equal(mutationNeedsMount(childListInside, '#oh-dsh-owned-root'), false)
})

test('mutationNeedsMount: an added node inside the owned root is ignored', () => {
  const owned = {
    nodeType: 1,
    matches: (selector: string): boolean => selector === '#oh-dsh-owned-root',
    parentNode: null,
  } as unknown as Element
  const inner = {
    nodeType: 1,
    matches: (): boolean => false,
    parentNode: owned,
  } as unknown as Node
  const record = mutationRecord({
    type: 'childList',
    target: {} as Node,
    addedNodes: [inner] as unknown as NodeList,
    removedNodes: [] as unknown as NodeList,
  })
  assert.equal(mutationNeedsMount(record, '#oh-dsh-owned-root'), false)
})

test('mutationNeedsMount: foreign subtree mutations retrigger the mount', () => {
  const foreign = {
    parentNode: null,
  } as unknown as Node
  const record = mutationRecord({
    type: 'childList',
    target: {} as Node,
    addedNodes: [foreign] as unknown as NodeList,
    removedNodes: [] as unknown as NodeList,
  })
  assert.equal(mutationNeedsMount(record, '#oh-dsh-owned-root'), true)
})

test('mutationNeedsMount: attribute changes outside the owned root count', () => {
  const record = mutationRecord({
    type: 'attributes',
    target: {} as Node,
  })
  assert.equal(mutationNeedsMount(record, '#oh-dsh-owned-root'), true)
})

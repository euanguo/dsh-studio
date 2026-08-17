import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  hasTabStripWheelModifier,
  resolveTabStripScroller,
  tabStripWheelDelta,
  type TabStripScrollElement,
} from '../plugins/shared/tab-strip-wheel.ts'

test('tab strip wheel: modifier keys are never hijacked', () => {
  assert.equal(hasTabStripWheelModifier({ shiftKey: true, ctrlKey: false, metaKey: false, altKey: false }), true)
  assert.equal(hasTabStripWheelModifier({ shiftKey: false, ctrlKey: true, metaKey: false, altKey: false }), true)
  assert.equal(hasTabStripWheelModifier({ shiftKey: false, ctrlKey: false, metaKey: true, altKey: false }), true)
  assert.equal(hasTabStripWheelModifier({ shiftKey: false, ctrlKey: false, metaKey: false, altKey: true }), true)
  assert.equal(hasTabStripWheelModifier({ shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }), false)
})

test('tab strip wheel: deltaMode converts to pixel deltas', () => {
  // deltaMode 0 (pixels): 1:1.
  assert.equal(tabStripWheelDelta(0, 4, 0, 1000), 4)
  // deltaMode 1 (lines): 16px per notch; a plain mouse wheel emits deltaY.
  assert.equal(tabStripWheelDelta(1, 0, 3, 1000), 48)
  // deltaMode 2 (pages): one container width per notch.
  assert.equal(tabStripWheelDelta(2, 0, 1, 800), 800)
  // Both axes compound.
  assert.equal(tabStripWheelDelta(1, 2, -1, 1000), 16)
})

function element(init: Partial<TabStripScrollElement> & { parentElement?: TabStripScrollElement | null }): TabStripScrollElement {
  return {
    scrollWidth: 0,
    clientWidth: 0,
    scrollLeft: 0,
    parentElement: null,
    ...init,
  }
}

test('tab strip wheel: the scroller resolver finds the overflowing host', () => {
  // The strip itself does not overflow (width == content); its scroller does.
  const scroller = element({ scrollWidth: 500, clientWidth: 200, scrollLeft: 0 })
  const strip = element({ scrollWidth: 500, clientWidth: 500, scrollLeft: 0, parentElement: scroller })
  assert.equal(resolveTabStripScroller(strip), scroller)
  // A non-overflowing chain yields null (page scrolls normally).
  const quiet = element({ scrollWidth: 100, clientWidth: 300, scrollLeft: 0 })
  const quietStrip = element({ scrollWidth: 100, clientWidth: 300, scrollLeft: 0, parentElement: quiet })
  assert.equal(resolveTabStripScroller(quietStrip), null)
})

test('tab strip wheel: an overflowing strip resolves to itself (right panel)', () => {
  const strip = element({ scrollWidth: 600, clientWidth: 300, scrollLeft: 0 })
  assert.equal(resolveTabStripScroller(strip), strip)
})
/**
 * Desktop chrome CSS contract (mirrors the reference distribution's
 * desktop-header-styles spec): the injected chrome layer must keep the
 * drag regions isolated from interactive elements and suspend them while a
 * modal is mounted.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const client = readFileSync(new URL('../src/client.ts', import.meta.url), 'utf8')

test('conversation header is the drag region with full interactive isolation', () => {
  assert.match(
    client,
    /\[data-slot='conversation'\] header\s*\{[^}]*webkit-app-region: drag;/s,
  )
  // Every interactive affordance is re-enabled inside the header.
  for (const selector of [
    "button", "a", "input", "select", "textarea",
    "[role='button']", "[role='link']", "[role='tab']",
    "[contenteditable='true']",
  ]) {
    assert.match(
      client,
      new RegExp(`\\[data-slot='conversation'\\] header ${selector}[^{]*\\{[^}]*webkit-app-region: no-drag;`),
    )
  }
})

test('modal mounts suspend every renderer drag region', () => {
  assert.match(
    client,
    /:has\(\[aria-modal='true'\]\) body \*[^{]*\{[^}]*webkit-app-region: no-drag;/s,
  )
})

test('titlebar inset is a token so surfaces follow the removal', () => {
  assert.match(
    client,
    /--oh-dsh-titlebar-height: \$\{DESKTOP_TITLEBAR_HEIGHT\}px;/,
  )
  assert.match(client, /const DESKTOP_TITLEBAR_HEIGHT = 0/)
})

test('fallback drag strip only appears when no usable header exists', () => {
  assert.match(
    client,
    // The bar requires BOTH no usable header AND no mounted center strip
    // (the strip is itself a drag region; the bar would swallow its
    // controls' clicks — see the comment in DESKTOP_CHROME_CSS).
    /body:not\(:has\(\[data-slot='conversation'\] header:not\(:empty\)\)\):not\(:has\(#oh-dsh-center-tabs-root\)\)::before[^{]*\{[^}]*webkit-app-region: drag;/s,
  )
})

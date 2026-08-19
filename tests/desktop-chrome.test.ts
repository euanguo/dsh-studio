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
const centerSurfaceCss = readFileSync(
  new URL('../plugins/sidebar/src/client/surfaces/center-surface.css', import.meta.url),
  'utf8',
)

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

test('portalled menus opt out of native window dragging', () => {
  assert.match(
    client,
    /html\[data-oh-dsh-desktop='true'\] \[role='menu'\][\s\S]*-webkit-app-region: no-drag;/,
  )
})

test('modal mounts suspend every renderer drag region', () => {
  assert.match(
    client,
    /:has\(\[aria-modal='true'\]\) body \*[^{]*\{[^}]*webkit-app-region: no-drag;/s,
  )
})

test('center tab hit area opts out while scroller whitespace stays draggable', () => {
  assert.match(
    centerSurfaceCss,
    /\.oh-dsh-center-tabs-strip\s*\{[^}]*-webkit-app-region: drag;/s,
  )
  assert.match(
    centerSurfaceCss,
    /\.oh-dsh-center-tabs-scroller\s*\{[^}]*display: flex;/s,
  )
  assert.match(
    centerSurfaceCss,
    /\.oh-dsh-center-tabs-scroller \.oh-dsh-surface-tab-strip\s*\{[^}]*-webkit-app-region: no-drag;/s,
  )
})

test('titlebar inset is a token so surfaces follow the removal', () => {
  assert.match(
    client,
    /--oh-dsh-titlebar-height: \$\{DESKTOP_TITLEBAR_HEIGHT\}px;/,
  )
  assert.match(client, /const DESKTOP_TITLEBAR_HEIGHT = 0/)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  htmlIframeSandboxAttribute,
  resolveHtmlSurfaceUnsafe,
} from '../plugins/sidebar/src/client/files/html-sandbox.ts'

test('html surface sandbox: sandboxed by default, per-surface unlock overrides', () => {
  // Defaults: sandboxed.
  assert.equal(resolveHtmlSurfaceUnsafe(false, false, null), false)
  // The per-surface unlock wins over a sandboxed default.
  assert.equal(resolveHtmlSurfaceUnsafe(false, false, true), true)
  // An explicit restore wins over the unsandboxed default.
  assert.equal(resolveHtmlSurfaceUnsafe(false, true, false), false)
  // No override: follow the default.
  assert.equal(resolveHtmlSurfaceUnsafe(false, true, null), true)
})

test('html surface sandbox: the global no-sandbox switch wins unconditionally', () => {
  assert.equal(resolveHtmlSurfaceUnsafe(true, false, false), true)
  assert.equal(resolveHtmlSurfaceUnsafe(true, false, null), true)
  assert.equal(resolveHtmlSurfaceUnsafe(true, true, false), true)
})

test('html iframe sandbox attribute reflects the state', () => {
  assert.equal(htmlIframeSandboxAttribute(false), '')
  assert.equal(htmlIframeSandboxAttribute(true), undefined)
})
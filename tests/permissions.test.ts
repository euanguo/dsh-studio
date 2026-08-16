import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allowsRuntimeClipboardWrite, originOf } from '../src/permissions.ts'

const runtimeOrigin = 'http://127.0.0.1:43210'

function request(overrides: Partial<Parameters<typeof allowsRuntimeClipboardWrite>[0]> = {}) {
  return {
    isMainFrame: true,
    permission: 'clipboard-sanitized-write',
    requestingOrigin: runtimeOrigin,
    runtimeOrigin,
    webContentsIsMainWindow: true,
    ...overrides,
  }
}

test('allows clipboard writes from the live DSH main frame', () => {
  assert.equal(allowsRuntimeClipboardWrite(request({
    requestingUrl: `${runtimeOrigin}/conversation`,
  })), true)
  assert.equal(allowsRuntimeClipboardWrite(request({
    requestingOrigin: `${runtimeOrigin}/`,
  })), true)
})

test('normalizes valid origins and fails closed for invalid URLs', () => {
  assert.equal(originOf(`${runtimeOrigin}/conversation`), runtimeOrigin)
  assert.equal(originOf('not a url'), undefined)
  assert.equal(originOf(undefined), undefined)
})

test('allows clipboard reads from the live DSH main frame and rejects other permissions', () => {
  // Electron 42 routes navigator.clipboard.writeText through the
  // clipboard-read permission, so reads must be allowed for writes to work.
  assert.equal(allowsRuntimeClipboardWrite(request({ permission: 'clipboard-read' })), true)
  assert.equal(allowsRuntimeClipboardWrite(request({ permission: 'clipboard-sanitized-write' })), true)
  assert.equal(allowsRuntimeClipboardWrite(request({ permission: 'notifications' })), false)
})

test('rejects clipboard access from untrusted frames and windows', () => {
  assert.equal(allowsRuntimeClipboardWrite(request({ isMainFrame: false })), false)
  assert.equal(allowsRuntimeClipboardWrite(request({ isMainFrame: false, permission: 'clipboard-read' })), false)
  assert.equal(allowsRuntimeClipboardWrite(request({ webContentsIsMainWindow: false })), false)
  assert.equal(allowsRuntimeClipboardWrite(request({ webContentsIsMainWindow: false, permission: 'clipboard-read' })), false)
  assert.equal(allowsRuntimeClipboardWrite(request({ requestingOrigin: 'https://example.com' })), false)
  assert.equal(allowsRuntimeClipboardWrite(request({ requestingOrigin: 'https://example.com', permission: 'clipboard-read' })), false)
  assert.equal(allowsRuntimeClipboardWrite(request({ requestingUrl: 'https://example.com/steal' })), false)
  assert.equal(allowsRuntimeClipboardWrite(request({ requestingUrl: 'https://example.com/steal', permission: 'clipboard-read' })), false)
  assert.equal(allowsRuntimeClipboardWrite(request({ requestingUrl: 'not a url' })), false)
})

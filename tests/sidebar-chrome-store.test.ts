import assert from 'node:assert/strict'
import { test } from 'node:test'
import { useSidebarChromeStore } from '../plugins/sidebar/src/client/runtimes/chrome-store.ts'

test('sidebar chrome store resolves unknown scopes to one stable default slice', () => {
  const store = useSidebarChromeStore.getState()
  // useSyncExternalStore selectors require a reference-stable snapshot: an
  // unknown scope must resolve to the SAME object on every evaluation, or
  // React loops to "maximum update depth" and unmounts the rail.
  const first = store.getSlice('session-a:/ws')
  assert.equal(first, store.getSlice('session-a:/ws'))
  assert.equal(first, useSidebarChromeStore.getState().getSlice('session-a:/ws'))
  assert.deepEqual(first.explorer.expandedPaths, [])
  assert.equal(first.gitListMode, 'tree')

  // Writing a scope replaces the default with that scope's own slice.
  store.setGitListMode('session-a:/ws', 'flat')
  const written = useSidebarChromeStore.getState().getSlice('session-a:/ws')
  assert.notEqual(written, first)
  assert.equal(written.gitListMode, 'flat')
  // Other scopes keep the stable default.
  assert.equal(useSidebarChromeStore.getState().getSlice('session-b:/ws'), first)

  // clearScope returns the scope to the stable default.
  useSidebarChromeStore.getState().clearScope('session-a:/ws')
  assert.equal(useSidebarChromeStore.getState().getSlice('session-a:/ws'), first)
})

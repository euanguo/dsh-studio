import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  clearAllLiveBrowserUrls,
  clearLiveBrowserUrl,
  getLiveBrowserUrl,
  rememberLiveBrowserUrl,
} from '../plugins/sidebar-desktop/src/client/browser-runtime.ts'

test('browser runtime remembers, restores, and clears live URLs per tabId', () => {
  clearAllLiveBrowserUrls()
  assert.equal(getLiveBrowserUrl('tab-1'), null)

  rememberLiveBrowserUrl('tab-1', 'https://github.com')
  rememberLiveBrowserUrl('tab-2', 'https://news.ycombinator.com')

  assert.equal(getLiveBrowserUrl('tab-1'), 'https://github.com')
  assert.equal(getLiveBrowserUrl('tab-2'), 'https://news.ycombinator.com')

  // about:blank is ignored
  rememberLiveBrowserUrl('tab-1', 'about:blank')
  assert.equal(getLiveBrowserUrl('tab-1'), 'https://github.com')

  clearLiveBrowserUrl('tab-1')
  assert.equal(getLiveBrowserUrl('tab-1'), null)
  assert.equal(getLiveBrowserUrl('tab-2'), 'https://news.ycombinator.com')

  clearAllLiveBrowserUrls()
  assert.equal(getLiveBrowserUrl('tab-2'), null)
})

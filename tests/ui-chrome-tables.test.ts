import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  UI_CHROME_DOMAIN_NAME,
  UI_CHROME_TABLES,
  defaultUiChromeFlags,
  isUiChromeTableName,
  sanitizeLeftRailViewChrome,
  sanitizeSidebarChrome,
  sanitizeUiChromeFlags,
} from '@dsh-studio/shared/ui-chrome-tables'

test('UI chrome uses runtime-valid domain and table names', () => {
  assert.match(UI_CHROME_DOMAIN_NAME, /^[a-z][a-z0-9_]*$/)
  for (const table of Object.values(UI_CHROME_TABLES)) {
    assert.match(table, /^[a-z][a-z0-9_]*$/)
    assert.equal(isUiChromeTableName(table), true)
  }
  assert.equal(isUiChromeTableName('left-rail-view'), false)
})

test('left-rail chrome sanitizer retains reproducible view state only', () => {
  const value = sanitizeLeftRailViewChrome({
    groupBy: 'flat',
    orderBy: 'manual',
    groupExpansion: { 'workspace:/repo': true, invalid: 'yes' },
    sessionOrder: { project: ['session-a', 'session-b'], invalid: [1] },
    sessionUpdatedAtByAccount: { project: { 'session-a': 1 } },
  })
  assert.deepEqual(value, {
    groupBy: 'flat',
    orderBy: 'manual',
    groupExpansion: { 'workspace:/repo': true },
    sessionOrder: { project: ['session-a', 'session-b'] },
  })
})

test('sidebar chrome sanitizer drops malformed scopes and clamps list mode', () => {
  const value = sanitizeSidebarChrome({
    byScope: {
      '/ws': {
        explorer: { expandedPaths: ['/a', 7, ''], selectedPath: '/a' },
        sourceControl: {
          collapsedSections: ['staged'],
          collapsedDirectories: 'not-a-list',
          selectedPath: null,
          commitMessage: 'draft',
        },
        gitListMode: 'flat',
      },
      '': { explorer: { expandedPaths: [] }, sourceControl: {}, gitListMode: 'tree' },
      broken: 3,
    },
  })
  assert.deepEqual(value, {
    byScope: {
      '/ws': {
        explorer: { expandedPaths: ['/a'], selectedPath: '/a' },
        sourceControl: {
          collapsedSections: ['staged'],
          collapsedDirectories: [],
          selectedPath: null,
          commitMessage: 'draft',
        },
        gitListMode: 'flat',
        diffView: { layout: 'unified', wordWrap: false },
      },
    },
  })
  // Anything that is not a plain record resolves to the empty state.
  assert.deepEqual(sanitizeSidebarChrome('junk'), { byScope: {} })
})

test('ui chrome flags sanitize to false unless explicitly true', () => {
  assert.deepEqual(sanitizeUiChromeFlags({
    pinnedSummaryOpen: true,
    pluginMarketplaceOpen: 'true',
  }), { pinnedSummaryOpen: true, pluginMarketplaceOpen: false })
  assert.deepEqual(sanitizeUiChromeFlags(null), defaultUiChromeFlags())
})

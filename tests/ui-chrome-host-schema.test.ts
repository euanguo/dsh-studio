/**
 * Host-side schema contract for the durable UI chrome tables.
 *
 * Guarded contract: `parseUiChromeValue` (the zod schemas derived from
 * `UI_CHROME_TABLE_SCHEMAS`) must accept every shape the browser clients
 * legitimately persist, at every nesting level. The derivation used to lose
 * `nullable` on strings and `optional`/`default` inside nested objects, so
 * opening the domain rejected stored records (`invalid-record`) and the whole
 * ui-chrome storage went dark — tabs stopped restoring after reload while
 * every write failed silently. The fixtures below mirror those exact shapes.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseUiChromeValue } from '../plugins/capabilities/src/ui-chrome-schemas.ts'
import {
  UI_CHROME_TABLES,
  sanitizeSidebarChrome,
} from '@dsh-studio/shared/ui-chrome-tables'

test('center_surfaces: nullable activeId and optional surface fields survive host parsing', () => {
  const stored = {
    byCwd: {
      '/repo/a': {
        open: [{
          id: 'conversation:s1', cwd: '/repo/a', title: 'chat', closable: true,
          kind: 'conversation', sessionId: 's1', isPreview: false,
        }],
        // An open workspace queue may legitimately have no active tab.
        activeId: null,
      },
      '/repo/b': {
        open: [{
          id: 'browser:', cwd: '/repo/b', title: 'Browser', closable: true,
          kind: 'browser', isPreview: false,
          // `resource` is optional in the descriptor — omit it entirely.
        }],
        activeId: 'browser:',
      },
    },
  }
  const parsed = parseUiChromeValue(UI_CHROME_TABLES.centerSurfaces, stored) as any
  assert.equal(parsed.byCwd['/repo/a'].activeId, null)
  assert.ok('resource' in parsed.byCwd['/repo/b'].open[0] === false)
})

test('sidebar_chrome: rows persisted before diffView existed parse with the host default', () => {
  const stored = {
    byScope: {
      '/repo': {
        explorer: { expandedPaths: [], selectedPath: null },
        sourceControl: { collapsedSections: [], collapsedDirectories: [], selectedPath: null, commitMessage: '' },
        gitListMode: 'tree',
      },
    },
  }
  const parsed = parseUiChromeValue(UI_CHROME_TABLES.sidebarChrome, stored) as any
  assert.deepEqual(parsed.byScope['/repo'].diffView, { layout: 'unified', wordWrap: false })
  assert.equal(parsed.byScope['/repo'].explorer.selectedPath, null)
})

test('sidebar_chrome: whatever the client sanitizer emits parses back on the host', () => {
  // The sanitizer is the release-time writer shape: its output (defaults
  // filled, nulls kept) must satisfy the derived host schema unchanged.
  const emitted = sanitizeSidebarChrome(undefined)
  const parsed = parseUiChromeValue(UI_CHROME_TABLES.sidebarChrome, emitted) as any
  assert.deepEqual(parsed.byScope, {})
  const populated = sanitizeSidebarChrome({ byScope: { '/repo': { gitListMode: 'flat' } } }) as any
  const reparsed = parseUiChromeValue(UI_CHROME_TABLES.sidebarChrome, populated) as any
  assert.equal(reparsed.byScope['/repo'].gitListMode, 'flat')
  assert.deepEqual(reparsed.byScope['/repo'].diffView, { layout: 'unified', wordWrap: false })
})

test('sidebar_layouts: legacy workspace rows without optional fields parse', () => {
  const stored = {
    defaultWidth: 360,
    openByDefault: false,
    workspaces: {
      '/repo': {
        activeId: null,
        lastUsed: 1_756_000_000_000,
        // No `width`, tabs carry only id/type/title (no resource/meta),
        // bottom fields omitted, nullable ids stored as null.
        tabs: [{ id: 'files:1', type: 'files', title: '文件' }],
        bottomActiveId: null,
      },
    },
    pluginSettings: {},
    centerPreviewTabs: 'default',
    layoutScope: 'workspace',
  }
  const parsed = parseUiChromeValue(UI_CHROME_TABLES.sidebarLayouts, stored) as any
  const workspace = parsed.workspaces['/repo']
  assert.equal(workspace.bottomActiveId, null)
  assert.ok('width' in workspace === false)
  assert.ok('meta' in workspace.tabs[0] === false)
})

test('left_rail_view: missing defaulted top-level fields are filled by the host', () => {
  const parsed = parseUiChromeValue(UI_CHROME_TABLES.leftRailView, {}) as any
  assert.equal(parsed.groupBy, 'workspace')
  assert.deepEqual(parsed.sessionOrder, {})
})

test('host schemas stay strict where the contract requires it', () => {
  assert.throws(() => parseUiChromeValue(UI_CHROME_TABLES.centerSurfaces, {
    byCwd: { '/repo': { open: [], activeId: 5 } },
  }))
  assert.throws(() => parseUiChromeValue(UI_CHROME_TABLES.centerSurfaces, {
    byCwd: { '/repo': { open: [{ id: 'x', cwd: '/repo', title: 'x', closable: true, kind: 'nope', isPreview: false }], activeId: null } },
  }))
  assert.throws(() => parseUiChromeValue(UI_CHROME_TABLES.sidebarChrome, {
    byScope: { '/repo': { explorer: { expandedPaths: [3], selectedPath: null } } },
  }))
})

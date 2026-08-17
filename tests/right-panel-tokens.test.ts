import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('shared theme defines semantic surface families for list rows, tabs, badges, and tables', () => {
  const themeCss = readFileSync(join(root, 'plugins/shared/theme.css'), 'utf8')

  assert.match(themeCss, /--oh-dsh-list-row-height:\s*var\(--oh-dsh-size-row\);/)
  assert.match(themeCss, /--oh-dsh-list-row-gap:\s*var\(--oh-dsh-space-1\);/)
  assert.match(themeCss, /--oh-dsh-list-row-radius:\s*var\(--oh-dsh-radius-sm\);/)
  assert.match(themeCss, /--oh-dsh-list-row-corner-shape:\s*round;/)

  assert.match(themeCss, /--oh-dsh-surface-tab-height:\s*26px;/)
  assert.match(themeCss, /--oh-dsh-surface-tab-radius:\s*var\(--oh-dsh-radius-sm\);/)
  assert.match(themeCss, /--oh-dsh-surface-tab-gap:\s*var\(--oh-dsh-space-1\);/)
  assert.match(themeCss, /--oh-dsh-surface-tab-bg-hover:/)
  assert.match(themeCss, /--oh-dsh-surface-tab-bg-active:/)

  assert.match(themeCss, /--oh-dsh-badge-height:\s*17px;/)
  assert.match(themeCss, /--oh-dsh-badge-min-width:\s*17px;/)
  assert.match(themeCss, /--oh-dsh-badge-radius:\s*var\(--oh-dsh-radius-pill\);/)

  assert.match(themeCss, /--oh-dsh-content-table-radius:\s*var\(--oh-dsh-radius-md\);/)
  assert.match(themeCss, /--oh-dsh-content-table-cell-padding-block:\s*var\(--oh-dsh-space-1-5\);/)
})

test('active desktop skin bridges right-panel list rows and surface tabs to left-rail geometry', () => {
  const skinsTs = readFileSync(join(root, 'plugins/desktop-skins/src/client/skins.ts'), 'utf8')

  assert.match(skinsTs, /--oh-dsh-list-row-height:\s*var\(--gw-skin-row-h\);/)
  assert.match(skinsTs, /--oh-dsh-list-row-gap:\s*var\(--gw-skin-gap-item\);/)
  assert.match(skinsTs, /--oh-dsh-list-row-radius:\s*var\(--gw-skin-radius-row\);/)
  assert.match(skinsTs, /--oh-dsh-list-row-corner-shape:\s*superellipse\(1\.5\);/)

  assert.match(skinsTs, /--oh-dsh-surface-tab-height:\s*var\(--gw-skin-row-h\);/)
  assert.match(skinsTs, /--oh-dsh-surface-tab-radius:\s*var\(--gw-skin-radius-row\);/)
  assert.match(skinsTs, /--oh-dsh-surface-tab-bg-active:\s*var\(--dsw-alias-interactive-bg-hover/)
  assert.match(skinsTs, /--oh-dsh-surface-tab-corner-shape:\s*superellipse\(1\.5\);/)
})

test('shared list-row, surface-tab, and commit rows consume semantic family tokens', () => {
  const listRowCss = readFileSync(join(root, 'plugins/shared/list-row.css'), 'utf8')
  const surfaceTabCss = readFileSync(join(root, 'plugins/shared/surface-tab.css'), 'utf8')
  const sidebarCss = readFileSync(join(root, 'plugins/sidebar/src/client/sidebar.css'), 'utf8')
  const sourceControlCss = readFileSync(join(root, 'plugins/sidebar/src/client/source-control/source-control.css'), 'utf8')
  const sideToolsCss = readFileSync(join(root, 'plugins/sidebar/src/client/side-tools.css'), 'utf8')

  assert.match(listRowCss, /height:\s*var\(--oh-dsh-list-row-height,\s*var\(--oh-dsh-size-row\)\);/)
  assert.match(listRowCss, /border-radius:\s*var\(--oh-dsh-list-row-radius,\s*var\(--oh-dsh-radius-sm\)\);/)
  assert.match(listRowCss, /corner-shape:\s*var\(--oh-dsh-list-row-corner-shape,\s*round\);/)
  assert.match(listRowCss, /margin-bottom:\s*var\(--oh-dsh-list-row-gap,\s*var\(--oh-dsh-space-1\)\);/)

  assert.match(surfaceTabCss, /height:\s*var\(--oh-dsh-surface-tab-height,\s*var\(--oh-dsh-list-row-height,\s*28px\)\)/)
  assert.match(surfaceTabCss, /border-radius:\s*var\(--oh-dsh-surface-tab-radius,\s*var\(--oh-dsh-list-row-radius/)
  assert.match(surfaceTabCss, /corner-shape:\s*var\(--oh-dsh-surface-tab-corner-shape,\s*superellipse\(1\.5\)\)/)

  assert.match(sidebarCss, /\.oh-dsh-review-commit-file\s*\{[^}]*height:\s*var\(--oh-dsh-list-row-height/s)
  assert.match(sidebarCss, /\.oh-dsh-review-commit-file\s*\{[^}]*border-radius:\s*var\(--oh-dsh-list-row-radius/s)
  assert.match(sidebarCss, /\.oh-dsh-review-commit-file\s*\{[^}]*margin-bottom:\s*var\(--oh-dsh-list-row-gap/s)
  assert.match(sidebarCss, /\.oh-dsh-review-commit-dir\s*\{[^}]*height:\s*var\(--oh-dsh-list-row-height/s)
  assert.match(sidebarCss, /\.oh-dsh-review-commit-dir\s*\{[^}]*border-radius:\s*var\(--oh-dsh-list-row-radius/s)
  assert.match(sidebarCss, /\.oh-dsh-workspace-count\s*\{[^}]*border-radius:\s*var\(--oh-dsh-badge-radius/s)

  assert.match(sourceControlCss, /\.oh-dsh-sc-mark\s*\{[^}]*border-radius:\s*var\(--oh-dsh-badge-radius/s)
  assert.match(sourceControlCss, /\.oh-dsh-sc-toolbar-title em\s*\{[^}]*border-radius:\s*var\(--oh-dsh-badge-radius/s)

  assert.doesNotMatch(sideToolsCss, /\.oh-dsh-file-list\s*>\s*button/)
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function source(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

/**
 * Architecture guard: the LayoutDom host is the only product-owned body/root
 * layout writer. Feature consumers may claim regions, but cannot retain the
 * retired panel-controls coordinator or write the app-root squeeze directly.
 */
test('right-panel geometry has one LayoutDom write point', () => {
  const layoutDom = source('plugins/shared/layout-dom.ts')
  assert.match(layoutDom, /appRoot: \(\) => document\.getElementById\('root'\)/)
  assert.match(layoutDom, /env\.body\.append\(element\)/)

  for (const relativePath of [
    'plugins/sidebar/src/client/workspace-tools.tsx',
    'plugins/pinned-summary/src/service.ts',
    'plugins/plugin-marketplace/src/client/marketplace-view.tsx',
  ]) {
    const text = source(relativePath)
    assert.doesNotMatch(text, /claimRightPanel|previewRightPanel|releaseRightPanel|applyRightPanel/)
    assert.doesNotMatch(text, /document\.body\.(append|appendChild)/)
    assert.doesNotMatch(text, /document\.getElementById\(['"]root['"]\)/)
  }
})

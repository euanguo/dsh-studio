import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('right panel footprint is coordinated by the desktopPanels service', () => {
  const summary = readFileSync(join(root, 'plugins/pinned-summary/src/client.ts'), 'utf8')

  // Plugins must not write the owner flag or #root padding themselves;
  // the squeeze is claimed exclusively through the desktopPanels service.
  assert.doesNotMatch(summary, /dshStudioRightPanelOwner = /)
  assert.doesNotMatch(summary, /getElementById\('root'\)\?\.style\.removeProperty\('padding-right'\)/)
})

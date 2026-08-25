import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

/**
 * Sidebar internal layering guard.
 *
 * The sidebar package is one package with TWO workbenches inside: the
 * right rail (the panel shell) and the center-surface subsystem. The
 * subsystems register through the public service contract and must never
 * reach into the rail's shell modules — that direction is what keeps a
 * future physical split (rail / surfaces packages) a move, not a rewrite.
 * This guard pins it:
 *
 * - client/surfaces/**, client/files/**,
 *   client/diff/**, client/source-control/**, client/subagent/**,
 *   client/review/**, and client/runtimes/** must NOT import the shell
 *   trio (SideToolsPanel, workspace-tools, workspace-panel) or the plugin
 *   assembly (plugin.tsx).
 *
 * The composition direction (plugin.tsx / workspace-tools importing the
 * subsystems and registering them) is allowed and expected.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientRoot = join(root, 'plugins', 'sidebar', 'src', 'client')

const SHELL_MODULES = [
  'SideToolsPanel.tsx',
  'workspace-tools.tsx',
  'workspace-panel.tsx',
  'plugin.tsx',
]

const SUBSYSTEM_DIRS = [
  'surfaces',
  'files',
  'diff',
  'source-control',
  'subagent',
  'review',
  'runtimes',
]

function subsystemFiles(): string[] {
  const files: string[] = []
  for (const dir of SUBSYSTEM_DIRS) {
    const dirPath = join(clientRoot, dir)
    for (const name of readdirSync(dirPath)) {
      if (name.endsWith('.ts') || name.endsWith('.tsx')) {
        files.push(join(dir, name))
      }
    }
  }
  return files
}

test('subsystems never import the rail shell modules', () => {
  const violations: string[] = []
  for (const file of subsystemFiles()) {
    const source = readFileSync(join(clientRoot, file), 'utf8')
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
    const depth = dir === '' ? 0 : dir.split('/').length
    for (const mod of SHELL_MODULES) {
      // A subsystem file at depth N escapes to client/ with N+1 '../'
      const ups = '../'.repeat(depth + 1)
      const base = mod.replace(/\.tsx?$/, '')
      const pattern = new RegExp(`from '${ups}${base}(\\.tsx?)?'`)
      if (pattern.test(source)) {
        violations.push(`${file} → ${mod}`)
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    'subsystem modules reaching into the rail shell (blocks the future package split)',
  )
})

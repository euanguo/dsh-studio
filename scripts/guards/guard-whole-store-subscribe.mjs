#!/usr/bin/env node
/**
 * guard-whole-store-subscribe.mjs — zustand selector discipline (rescan c9
 * rule generalized).
 *
 * Contract: client components must not subscribe to an entire store with an
 * identity selector like `useSessions(state => state)` — that re-renders on
 * every store change. Select the fields you use
 * (`useSessions(state => state.jobs)`). Applies to every plugin client tree
 * and src/.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WHOLE_STORE_RE = /\buse[A-Z]\w*\(\s*(?:state|s)\s*=>\s*(?:state|s)\s*[,)]/g
const SCAN_DIRS = [
  'plugins/capabilities/src',
  'plugins/desktop-left-rail/src',
  'plugins/desktop-skins/src',
  'plugins/panel-controls/src',
  'plugins/pinned-summary/src',
  'plugins/plugin-marketplace/src',
  'plugins/shared/src',
  'plugins/sidebar-desktop/src',
  'plugins/sidebar/src/client',
  'plugins/tui/src',
  'plugins/vision/src',
  'plugins/workbench/src',
  'src',
]

function filesUnder(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) filesUnder(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

const violations = []
for (const dir of SCAN_DIRS) {
  for (const file of filesUnder(join(root, dir))) {
    const text = readFileSync(file, 'utf8')
    const rel = file.slice(root.length + 1)
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      WHOLE_STORE_RE.lastIndex = 0
      const m = WHOLE_STORE_RE.exec(lines[i])
      if (m) violations.push(`${rel}:${i + 1}: whole-store subscription "${m[0]}" — select specific fields`)
    }
  }
}

if (violations.length > 0) {
  console.log('guard-whole-store-subscribe violations:')
  for (const v of violations) console.log(`  ${v}`)
  console.log('GUARD-FAIL(whole-store identity selectors)')
  process.exit(1)
}
console.log('GUARD-OK')

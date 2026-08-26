#!/usr/bin/env node
/**
 * guard-overlay-arbiter.mjs — S6 singleton discipline for the hover-comment
 * overlay arbiter (rescan c16 rules made durable).
 *
 * Contract for `plugins/sidebar/src/client/selection/overlay-arbiter.tsx`:
 *   - the arbiter is created through the `createOverlayArbiter()` factory;
 *   - NO module-level mutable singleton (`let currentOwner` / a shared
 *     instance exported at module top level) — instances travel through
 *     React context so two sidebar hosts never fight over one owner slot.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const file = join(root, 'plugins', 'sidebar', 'src', 'client', 'selection', 'overlay-arbiter.tsx')
const rel = 'plugins/sidebar/src/client/selection/overlay-arbiter.tsx'

const violations = []
let text = ''
try {
  text = readFileSync(file, 'utf8')
} catch {
  console.log(`guard-overlay-arbiter violations:\n  ${rel}: missing arbiter module`)
  console.log('GUARD-FAIL(arbiter module absent)')
  process.exit(1)
}

if (!/createOverlayArbiter/.test(text)) {
  violations.push(`${rel}: arbiter must be built by createOverlayArbiter() factory`)
}
if (/^let currentOwner|^const currentOwner/m.test(text)) {
  violations.push(`${rel}: module-level currentOwner singleton is forbidden`)
}
if (/^export const requestExclusive|^export const shared\b|^const shared = createOverlayArbiter/m.test(text)) {
  violations.push(`${rel}: module-level shared instance/export is forbidden`)
}

if (violations.length > 0) {
  console.log('guard-overlay-arbiter violations:')
  for (const v of violations) console.log(`  ${v}`)
  console.log('GUARD-FAIL(arbiter singleton discipline)')
  process.exit(1)
}
console.log('GUARD-OK')

#!/usr/bin/env node
/**
 * Verify the @dsh-studio/shared exports map: every entry's target must exist
 * (the map is hand-maintained — a dangling entry like the former
 * `./terminal-history` only fails at import time with a cryptic error).
 * Exits non-zero when a target is missing. Wired into scripts/build.mjs.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sharedDir = join(root, 'plugins', 'shared')
const manifest = JSON.parse(readFileSync(join(sharedDir, 'package.json'), 'utf8'))
const exportsMap = manifest.exports

if (exportsMap === undefined || typeof exportsMap !== 'object') {
  console.error('[verify-shared-exports] plugins/shared/package.json declares no exports map')
  process.exit(1)
}

const targets = []
for (const [entry, value] of Object.entries(exportsMap)) {
  if (typeof value === 'string') {
    targets.push([entry, value])
  } else if (value !== null && typeof value === 'object') {
    for (const [condition, target] of Object.entries(value)) {
      if (typeof target === 'string') targets.push([`${entry} (${condition})`, target])
    }
  }
}

const missing = targets.filter(([, target]) => !existsSync(join(sharedDir, target)))
if (missing.length > 0) {
  console.error(`[verify-shared-exports] ${missing.length} dangling export(s):`)
  for (const [entry, target] of missing) {
    console.error(`  ${entry} -> ${target} (missing)`)
  }
  process.exit(1)
}

console.log(
  `[verify-shared-exports] ${targets.length} export targets under plugins/shared all resolve`,
)
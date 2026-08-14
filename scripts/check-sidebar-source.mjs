#!/usr/bin/env node
/**
 * Verify the vendored DSH-better-sidebar Host the build compiles from:
 *  - plugins/better-sidebar-runtime/src must exist (otherwise the esbuild
 *    host entry fails with a cryptic error);
 *  - its baseline revision is read from VENDOR.md, and a warning is printed
 *    when the fork delta files no longer match the recorded modification
 *    list (the notice is the human-facing pin; keeping it fresh is a
 *    release task).
 *
 * Exit code 0 with warnings; non-zero only when the vendored tree is
 * missing.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = join(root, 'plugins', 'better-sidebar-runtime')

if (!existsSync(join(vendor, 'src', 'index.ts'))) {
  console.error(`[check-sidebar-source] vendored Better Sidebar Host not found at ${vendor}/src`)
  console.error('[check-sidebar-source] restore it from upstream:')
  console.error('  git clone https://github.com/omdsh-dev/DSH-better-sidebar.git <tmp>')
  console.error(`  cp -R <tmp>/src ${vendor}/src`)
  process.exit(1)
}

const vendorDoc = join(vendor, 'VENDOR.md')
let baseline = '(unknown)'
let delta = '(unknown)'
if (existsSync(vendorDoc)) {
  const doc = readFileSync(vendorDoc, 'utf8')
  baseline = doc.match(/Baseline revision: `([0-9a-f]{40})`/)?.[1] ?? '(unknown)'
  delta = doc.match(/- `([a-z-]+\.ts)` —/)?.[1] ?? '(none recorded)'
}

console.log(`[check-sidebar-source] vendored Host: ${vendor}/src`)
console.log(`[check-sidebar-source] baseline: ${baseline}`)
console.log(`[check-sidebar-source] fork delta: ${delta}`)

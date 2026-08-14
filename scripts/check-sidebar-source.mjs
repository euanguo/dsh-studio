#!/usr/bin/env node
/**
 * Verify the local DSH-better-sidebar clone the build compiles from:
 *  - the sibling directory must exist and be a git checkout (otherwise the
 *    esbuild host entry fails with a cryptic error);
 *  - its HEAD revision is reported, and a warning is printed when it no
 *    longer matches the revision recorded in THIRD_PARTY_NOTICES.md (the
 *    notice is the human-facing pin; keeping it fresh is a release task).
 *
 * Exit code 0 with warnings; non-zero only when the clone is missing.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clone = join(root, '..', 'DSH-better-sidebar')

if (!existsSync(join(clone, 'src', 'index.ts'))) {
  console.error(`[check-sidebar-source] DSH-better-sidebar clone not found at ${clone}`)
  console.error('[check-sidebar-source] clone it once with:')
  console.error('  git clone https://github.com/omdsh-dev/DSH-better-sidebar.git <sibling-of-this-repo>/DSH-better-sidebar')
  process.exit(1)
}

let revision = '(not a git checkout)'
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: clone,
    encoding: 'utf8',
  }).trim()
} catch {
  // A plain source copy works for the build; the pin check below just skips.
}

console.log(`[check-sidebar-source] local clone: ${clone}`)
console.log(`[check-sidebar-source] HEAD: ${revision}`)

const noticesPath = join(root, 'THIRD_PARTY_NOTICES.md')
if (existsSync(noticesPath)) {
  const notices = readFileSync(noticesPath, 'utf8')
  const match = notices.match(/revision\s+`([0-9a-f]{40})`/)
  const pinned = match?.[1]
  if (pinned !== undefined && revision !== pinned && /^[0-9a-f]{40}$/.test(revision)) {
    console.warn(`[check-sidebar-source] WARNING: HEAD (${revision.slice(0, 7)}) differs from the revision pinned in THIRD_PARTY_NOTICES.md (${pinned.slice(0, 7)})`)
    console.warn('[check-sidebar-source] update THIRD_PARTY_NOTICES.md when you intentionally advance the clone')
  }
}

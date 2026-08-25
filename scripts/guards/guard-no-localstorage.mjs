#!/usr/bin/env node
/**
 * guard-no-localstorage.mjs — persistVia / host-domain persistence discipline.
 *
 * Scans every `plugins/<plugin>/src/client/**` evergreen source for direct
 * browser storage writes/reads. Persistence must go through the shared
 * `persistVia` facade onto a host-owned domain (`ui-chrome` table, settings
 * namespace, or `nodeFs`); components must not touch `localStorage` /
 * `sessionStorage` themselves.
 *
 * Comments that only mention localStorage deliberately do not count. Only
 * real invocations (`localStorage.getItem/setItem/removeItem` and
 * `sessionStorage.*`) are flagged.
 *
 * License exceptions (legacy or adapter-only, each with a `// unwired-capability:`
 * or comment explaining why):
 *   - plugins/shared/comments-migration.ts — one-way legacy localStorage read
 *     migration into the domain-backed `comments` ui-chrome table.
 *   - plugins/sidebar/src/client/kit/keymap.ts — the restored localStorage
 *     override persistence half (leaf-R1 ③ / Q9).
 *
 * Output: a violation list (file:line) then exit 1; when clean prints
 * `GUARD-OK` and exits 0.
 *
 * Usage: node scripts/guards/guard-no-localstorage.mjs [--verbose]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const rootAbs = root

// Paths (relative to repo root) that are exempt.
const ALLOWLIST = [
  'plugins/shared/comments-migration.ts',
  'plugins/sidebar/src/client/kit/keymap.ts',
]

// Matches real browser storage invocations but not prose that merely says the word.
const STORAGE_RE =
  /\bwindow\.localStorage\.(?:get|set|remove)Item\b|(?<!\.localStorage)localStorage\.(?:get|set|remove)Item\b|\bsessionStorage\./g

function walk(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'dist' || e.name === 'node_modules') continue
      walk(p, out)
    } else {
      out.push(p)
    }
  }
  return out
}

const violations = []
let scanned = 0
for (const entry of readdirSync(join(rootAbs, 'plugins'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const clientRoot = join(rootAbs, 'plugins', entry.name, 'src', 'client')
  let stat
  try {
    stat = statSync(clientRoot)
  } catch {
    continue // no client dir
  }
  if (!stat.isDirectory()) continue
  for (const file of walk(clientRoot, [])) {
    const rel = relative(rootAbs, file)
    if (ALLOWLIST.includes(rel)) continue
    scanned++
    const text = readFileSync(file, 'utf8')
    STORAGE_RE.lastIndex = 0
    let m
    while ((m = STORAGE_RE.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length
      violations.push(`${rel}:${line}`)
    }
  }
}

if (violations.length > 0) {
  console.log(`VIOLATIONS guard-no-localstorage (${violations.length}):`)
  for (const v of violations) console.log(`  ${v}`)
  process.exit(1)
}
console.log(`guard-no-localstorage scanned ${scanned} client files; all persistence goes through host domains`)
console.log('GUARD-OK')
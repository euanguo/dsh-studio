#!/usr/bin/env node
/**
 * run-all.mjs — aggregate guard runner (report-all semantics).
 *
 * Runs every scripts/guards/guard-*.mjs sequentially (plus `biome check .`
 * is wired BEFORE this runner in the `check:guards` script) and reports the
 * complete failure set instead of masking later guards behind the first
 * failure of an `&&` chain. dead-exports runs with --strict here so the
 * allowlist in scripts/dead-export-allowlist.json is actually policed.
 *
 * Usage:
 *   node scripts/guards/run-all.mjs
 *   node scripts/guards/run-all.mjs --extra /tmp/fail-a.sh,/tmp/fail-b.sh
 *
 * `--extra` appends arbitrary commands (comma-separated) to the executed
 * list. It exists purely for negative-control testing of the summary
 * semantics and is not used by CI.
 */
import { readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const extraIndex = process.argv.indexOf('--extra')
const extra = extraIndex >= 0 ? String(process.argv[extraIndex + 1] ?? '') : ''
const extraCommands = extra.split(',').map(s => s.trim()).filter(Boolean)

const guardsDir = join(root, 'scripts', 'guards')
const guards = readdirSync(guardsDir)
  .filter(name => /^guard-.*\.mjs$/.test(name))
  .sort()
  .map(name => ({ name, command: 'node', args: [join(guardsDir, name), ...(name === 'guard-dead-exports.mjs' ? ['--strict'] : [])] }))

const jobs = [
  ...guards,
  ...extraCommands.map(cmd => ({ name: `extra:${cmd}`, command: cmd, args: [] })),
]

const results = []
for (const job of jobs) {
  const result = spawnSync(job.command, job.args, { cwd: root, encoding: 'utf8' })
  const ok = result.status === 0 && result.error === undefined
  results.push({ name: job.name, ok })
}

let failures = 0
for (const r of results) {
  if (r.ok) console.log(`OK   ${r.name}`)
  else { console.log(`FAIL ${r.name}`); failures += 1 }
}

if (failures > 0) {
  console.log(`SUMMARY: ${failures} guard(s) failed:`)
  for (const r of results) if (!r.ok) console.log(`  - ${r.name}`)
  process.exit(1)
}
console.log('GUARDS-ALL-OK')

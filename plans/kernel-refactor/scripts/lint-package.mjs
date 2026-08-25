#!/usr/bin/env node
/**
 * lint-package.mjs — lint every ledger in the kernel-refactor plan package.
 *
 * Runs the unlazy gate-lint on GATES.md plus every gates/*.md ledger and
 * fails if any ledger reports findings. Warnings are surfaced but advisory
 * (non-strict mode), matching the skill's default posture.
 *
 * Usage: node plans/kernel-refactor/scripts/lint-package.mjs [--strict]
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)))
const gateLint = '/Users/verger/.agents/skills/unlazy/scripts/gate-lint.mjs'
const strict = process.argv.includes('--strict')

const ledgers = [
  join(pkgDir, 'GATES.md'),
  ...readdirSync(join(pkgDir, 'gates'))
    .filter(f => f.endsWith('.md'))
    .map(f => join(pkgDir, 'gates', f)),
]

let failed = false
for (const ledger of ledgers) {
  const result = spawnSync(process.execPath, [gateLint, ...(strict ? ['--strict'] : []), ledger], {
    encoding: 'utf8',
  })
  const name = ledger.replace(pkgDir + '/', '')
  const output = (result.stdout ?? '') + (result.stderr ?? '')
  const ok = strict ? result.status === 0 : output.includes('LINT OK') || output.includes('LINT FINDINGS') === false && result.status === 0
  if (!ok || result.status !== 0) {
    failed = true
    console.error(`FAIL ${name}`)
    console.error(output.trim())
  } else {
    console.log(`pass ${name}: ${output.trim().split('\n').pop()}`)
  }
}
if (failed) process.exit(1)
console.log('PACKAGE-LINT-OK')

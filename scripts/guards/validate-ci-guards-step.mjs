#!/usr/bin/env node
/**
 * validate-ci-guards-step.mjs — leaf-5.3 G2 helper.
 *
 * Asserts the GitHub Actions workflow wires `check:guards` into a job step,
 * plus a conservative structural sanity pass over the YAML text (two-space
 * indent steps, no tab indentation) so a broken edit cannot sneak the step
 * out of a valid job. Full grammar validation happens when Actions itself
 * parses the file on CI; this guard protects the wiring contract in-repo
 * without pulling in a YAML dependency.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const file = join(root, '.github', 'workflows', 'ci.yml')
const text = readFileSync(file, 'utf8')

const problems = []
if (/^\t/m.test(text)) problems.push('tab indentation found')

let sawGuardsStep = false
const lines = text.split('\n')
for (let i = 0; i < lines.length; i++) {
  const line = lines[i]
  const m = /^(\s*)- name: (.+)$/.exec(line)
  if (!m) continue
  // The step body follows until the next line at <= the dash indent.
  const dashIndent = m[1].length
  let run = ''
  for (let j = i + 1; j < lines.length; j++) {
    const next = lines[j]
    if (next.trim() === '' || next.startsWith(' '.repeat(dashIndent + 2))) {
      const runMatch = /^(\s*)run: (.+)$/.exec(next)
      if (runMatch && runMatch[1].length > dashIndent) run += `${runMatch[2]}\n`
      continue
    }
    break
  }
  if (/check:guards/.test(line) || /check:guards/.test(run)) sawGuardsStep = true
}

if (!sawGuardsStep) problems.push('no step wires check:guards into a job')
if (problems.length > 0) {
  console.log('validate-ci-guards-step problems:')
  for (const p of problems) console.log(`  ${p}`)
  process.exit(1)
}
console.log('CI-GUARDS-STEP-OK')

#!/usr/bin/env node
/**
 * rescan-shim.mjs — thin wrapper that exposes the RG5 final-scan oracle
 * (rescan.mjs) from the repo root.
 *
 * rescan.mjs lives under `.agent-workflows/deep-refactor-exec/scripts/` and
 * resolves the repository root from `process.cwd()`, so it must be run from
 * the repo root. This shim re-executes it so `scripts/guards` can be the
 * single CI/pre-commit entry point for the whole防再犯 set.
 *
 * Usage: node scripts/guards/rescan-shim.mjs [--stage final|w1|w2|w3|w4|w5]
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const rescan = join(
  repoRoot,
  '.agent-workflows',
  'deep-refactor-exec',
  'scripts',
  'rescan.mjs',
)

const args = process.argv.slice(2)
const r = spawnSync(process.execPath, [rescan, ...args], {
  cwd: repoRoot,
  stdio: 'inherit',
})
process.exit(r.status === null ? 1 : r.status)
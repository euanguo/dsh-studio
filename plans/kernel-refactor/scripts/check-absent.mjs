#!/usr/bin/env node
/**
 * check-absent.mjs — legacy-symbol absence oracle for the kernel-refactor
 * plan package.
 *
 * Scans repository files matching glob specs and fails when any forbidden
 * regex pattern still matches. This is the shared "no shim / old path is
 * deleted" oracle referenced by leaf gates; it exists so every cutover leaf
 * proves deletion with the same detector instead of ad-hoc greps.
 *
 * Usage:
 *   node plans/kernel-refactor/scripts/check-absent.mjs --spec <spec.json> [--root <dir>]
 *   node plans/kernel-refactor/scripts/check-absent.mjs --self-test
 *
 * Spec JSON shape:
 * {
 *   "description": "why these symbols must be gone",
 *   "scan": ["plugins/sidebar/src/**", "src/**"],     // repo-relative globs
 *   "forbid": [
 *     { "pattern": "acquireOpenPathPatch", "reason": "openPath hijack deleted" }
 *   ],
 *   "allowFiles": ["**" + "/**.test.ts"]              // optional path globs to skip
 * }
 *
 * Output: prints ABSENT-OK and exits 0 only when no forbidden pattern matches
 * any scanned file. Prints SELFTEST-OK after the embedded positive control.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const args = { root: null, spec: null, selfTest: false }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--self-test') args.selfTest = true
    else if (a === '--root') { i += 1; args.root = argv[i] }
    else if (a === '--spec') { i += 1; args.spec = argv[i] }
    else throw new Error(`unknown argument: ${a}`)
  }
  return args
}

function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i += 1
        if (glob[i + 1] === '/') i += 1 // `**/` also matches zero segments
      } else {
        re += `[^${sep.replace('\\', '\\\\')}]*`
      }
    } else if (ch === '?') re += '[^/]'
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

function walk(dir, root, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, root, out)
    else out.push(relative(root, p).split(sep).join('/'))
  }
  return out
}

function selectFiles(root, scanGlobs, allowGlobs) {
  const files = walk(root, root, [])
  const include = scanGlobs.map(globToRegExp)
  const allow = allowGlobs.map(globToRegExp)
  return files.filter(f =>
    include.some(re => re.test(f)) && !allow.some(re => re.test(f)))
}

function runSpec(specPath, root) {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const forbid = spec.forbid.map(f => ({ ...f, re: new RegExp(f.pattern, f.flags ?? '') }))
  const files = selectFiles(root, spec.scan ?? ['**'], spec.allowFiles ?? [])
  const hits = []
  for (const rel of files) {
    let text
    try {
      text = readFileSync(join(root, rel), 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (const f of forbid) {
      for (let i = 0; i < lines.length; i += 1) {
        f.re.lastIndex = 0
        if (f.re.test(lines[i])) {
          hits.push(`${rel}:${i + 1}: /${f.pattern}/ ${f.reason ?? ''}`.trim())
        }
      }
    }
  }
  // File-level absences: the named artifacts themselves must be deleted.
  for (const glob of spec.forbidFiles ?? []) {
    const re = globToRegExp(glob)
    for (const rel of selectFiles(root, [glob], [])) {
      void re
      hits.push(`${rel}: forbidden file still present`)
    }
  }
  if (hits.length > 0) {
    console.error(`LEGACY-SYMBOLS-PRESENT (${hits.length})`)
    for (const h of hits.slice(0, 50)) console.error(`  ${h}`)
    process.exit(1)
  }
  console.log('ABSENT-OK')
}

async function selfTest() {
  // Positive control: the detector must fail on a planted symbol in a temp
  // fixture tree, proving that absence results are not vacuous.
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } =
    await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  const dir = mkdtempSync(join(tmpdir(), 'check-absent-'))
  try {
    mkdirSync(join(dir, 'pkg/src'), { recursive: true })
    writeFileSync(join(dir, 'pkg/src/old.ts'), 'export function acquireOpenPathPatch() {}\n')
    writeFileSync(join(dir, 'pkg/src/new.ts'), 'export function openViaPipeline() {}\n')
    const specPath = join(dir, 'spec.json')
    writeFileSync(specPath, JSON.stringify({
      description: 'self-test',
      scan: ['pkg/src/**'],
      forbid: [{ pattern: 'acquireOpenPathPatch', reason: 'planted control' }],
    }))
    const negative = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--spec', specPath, '--root', dir], { encoding: 'utf8' })
    const negativeOutput = negative.stdout + negative.stderr
    if (negative.status !== 1 || !negativeOutput.includes('LEGACY-SYMBOLS-PRESENT')) {
      console.error('SELFTEST-FAIL: detector did not flag planted symbol')
      console.error(negativeOutput)
      process.exit(1)
    }
    writeFileSync(join(dir, 'pkg/src/old.ts'), 'export function migrated() {}\n')
    const positive = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--spec', specPath, '--root', dir], { encoding: 'utf8' })
    if (positive.status !== 0 || !positive.stdout.includes('ABSENT-OK')) {
      console.error('SELFTEST-FAIL: clean tree did not pass')
      process.exit(1)
    }
    console.log('SELFTEST-OK')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const args = parseArgs(process.argv.slice(2))
if (args.selfTest) {
  await selfTest()
} else if (args.spec) {
  runSpec(args.spec, args.root ?? process.cwd())
} else {
  console.error('usage: check-absent.mjs --spec <spec.json> [--root <dir>] | --self-test')
  process.exit(2)
}

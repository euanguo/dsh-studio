#!/usr/bin/env node
/**
 * guard-dead-exports.mjs — warn on @dsh-studio/shared exports with ≤1
 * external reference (dead/aging exports), allowlist-driven.
 *
 * The shared package is the cross-plugin contract surface. An export that
 * nothing outside its own module imports is either dead weight or an
 * early-stage contract. This guard lists those so the team prunes or keeps
 * them consciously — it does not fail CI on its own.
 *
 * How it works:
 *   1. Read `plugins/shared/package.json` `exports` → the shared source files.
 *   2. Extract every named `export {const|function|class|interface|type|enum}
 *      symbol` from those files.
 *   3. Count word-boundary occurrences of each symbol across ALL repository
 *      source files (excluding the declaring module, node_modules, build
 *      output, docs, guards, tests fixtures).
 *   4. An export with ≤1 external occurrence is a dead-export candidate.
 *
 * Modes:
 *   - default (warning): prints the candidate list (file:symbol), prints
 *     `GUARD-OK`, exits 0.
 *   - --strict: the same list minus the allowlist becomes a violation — prints
 *     the list and exits 1. The allowlist is `.unlazy/dead-export-allowlist.json`
 *     (relative to repo root), an array of qualified names `module:symbol`.
 *
 * Usage:
 *   node scripts/guards/guard-dead-exports.mjs            # warn only
 *   node scripts/guards/guard-dead-exports.mjs --strict   # fail on non-allowlisted
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const strict = process.argv.includes('--strict')

const sharedDir = join(root, 'plugins', 'shared')
const manifest = JSON.parse(readFileSync(join(sharedDir, 'package.json'), 'utf8'))
const exportsMap = manifest.exports ?? {}

// Source file for each shared export entry (resolved under plugins/shared).
const sharedFiles = new Set()
for (const value of Object.values(exportsMap)) {
  let target
  if (typeof value === 'string') target = value
  else if (value && typeof value === 'object') target = Object.values(value)[0]
  if (typeof target === 'string' && target.endsWith('.ts')) {
    sharedFiles.add(join(sharedDir, target))
  }
}

// Extract named `export <kw> name` (and `export { name }` re-exports).
const DECL_RE = /\bexport\s+(?:async\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
const NAMED_RE = /\bexport\s+\{\s*([^}]+?)\s*\}/g

function filesUnder(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.stage' || e.name === 'release' || e.name === '.git' || e.name === '.agent-workflows' || e.name === '.unlazy' || e.name === '.workflow') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) filesUnder(p, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p)
  }
  return out
}

// All source files in the repo we search for references.
const repoFiles = filesUnder(root)

// name -> { declaringFiles:Set, total:[file,occ], nonDeclaring:Set }
const exports = new Map()
function addExport(symbol, declaringFile) {
  if (!exports.has(symbol)) exports.set(symbol, { declaring: [], occurrences: [] })
  exports.get(symbol).declaring.push(declaringFile)
}

for (const file of sharedFiles) {
  if (!existsSync(file)) continue
  const text = readFileSync(file, 'utf8')
  let m
  DECL_RE.lastIndex = 0
  while ((m = DECL_RE.exec(text)) !== null) addExport(m[1], file)
  NAMED_RE.lastIndex = 0
  while ((m = NAMED_RE.exec(text)) !== null) {
    for (const item of m[1].split(',')) {
      const sym = item.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(sym)) addExport(sym, file)
    }
  }
}

// Count word-boundary occurrences per file; attribute to non-declaring files.
const wordRe = (sym) => new RegExp(`\\b${sym}\\b`, 'g')
const external = new Map()
for (const sym of exports.keys()) {
  external.set(sym, new Set())
}
// Files that declare the symbol do not count as external references.
const declaredIn = new Map()
for (const [sym, info] of exports) {
  declaredIn.set(sym, new Set(info.declaring))
}

for (const file of repoFiles) {
  const rel = relative(root, file)
  if (rel.startsWith('scripts' + '/guards')) continue
  const text = readFileSync(file, 'utf8')
  for (const [sym] of exports) {
    const declSet = declaredIn.get(sym)
    if (declSet.has(file)) continue // declaring module: not an external ref
    const m = text.match(wordRe(sym))
    if (m && m.length > 0) external.get(sym).add(file)
  }
}

// Dead-export candidates: ≤1 external file references the symbol.
const candidates = []
for (const [sym, info] of exports) {
  const ext = external.get(sym).size
  if (ext <= 1) {
    const declaring = info.declaring.map((f) => relative(sharedDir, f)).join('/')
    candidates.push({ sym, declaring, ext, extFiles: [...external.get(sym)].map((f) => relative(root, f)) })
  }
}
candidates.sort((a, b) => a.declaring.localeCompare(b.declaring) || a.sym.localeCompare(b.sym))

// Allowlist: `plugin-shared-qualified:symbol` or `module:symbol`.
let allowlist = []
const allowPath = join(root, '.unlazy', 'dead-export-allowlist.json')
if (existsSync(allowPath)) {
  try {
    const parsed = JSON.parse(readFileSync(allowPath, 'utf8'))
    allowlist = Array.isArray(parsed) ? parsed : parsed.allow || []
  } catch {
    allowlist = []
  }
}
const isAllowlisted = (cand) =>
  allowlist.some((key) => {
    const [mod, sym] = String(key).split(':')
    return sym === cand.sym && (cand.declaring === mod || cand.declaring.endsWith(mod))
  })

const shown = candidates.filter((c) => !isAllowlisted(c))
if (shown.length > 0) {
  console.log(`guard-dead-exports ${strict ? 'VIOLATIONS' : 'warnings'} (${shown.length} dead/aging exports, allowlisted excluded):`)
  for (const c of shown) {
    const refs = c.extFiles.length ? ` ext refs=${c.ext}:${c.extFiles.join(',')}` : ' ext refs=0'
    console.log(`  ${c.sym}  (module ${c.declaring}${refs})`)
  }
} else {
  console.log('guard-dead-exports: no dead/aging exports outside the allowlist')
}

if (strict && shown.length > 0) {
  console.log('... add a real consumer or move the export to '
    + '.unlazy/dead-export-allowlist.json with a comment in the owning module')
  console.log('GUARD-FAIL(candidates above)')
  process.exit(1)
}
console.log('GUARD-OK')
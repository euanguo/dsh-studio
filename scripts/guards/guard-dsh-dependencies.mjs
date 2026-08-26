#!/usr/bin/env node
/**
 * guard-dsh-dependencies.mjs — bundled-inventory reconciliation for the
 * @deepseek-ai dependency fact source (AGENTS.md "config contracts guarded
 * structurally" + inventory 对拍 scenario; positive control self-tested below).
 *
 * Guarded contract: `config/dsh-dependencies.json` is the single writable
 * dependency-fact point (pin/inject/externals/typePackages/bundles). The
 * physical duplicates it generates must match it exactly, and the hand-owned
 * inventories it must stay consistent with are checked here — none of them is
 * a second writable dependency list:
 *
 *   1. pin        dsh-source.json == deriveDshSource(config.runtime)
 *   2. inject     package.json `dsh.client.inject` == config.inject
 *   3. tsconfig   tsconfig.json `compilerOptions.paths` == seeds derived from
 *                 config.typePackages; each seed resolves through the pinned
 *                 package's exports.types whenever the npm-types sandbox is
 *                 installed (skipped gracefully on clean checkouts)
 *   4. chain      config.inject entries owned by this repo (@dsh-studio/*)
 *                 ⊆ cordis.patch.yml `- insert` names ⊆ src/profile.ts
 *                 BUNDLED_DESKTOP_* plugins; official (@deepseek-ai/*) inject
 *                 entries are runtime-provided by the pinned release recorded
 *                 in the same config
 *   5. bundles    profile.ts surface bundle lists start with the upstream
 *                 prefixes from config.bundles (the trailing studio entry is
 *                 surface composition owned by profile.ts)
 *   6. externals  every @deepseek-ai/* specifier imported by repository
 *                 sources is covered by the configured external whitelist;
 *                 imports reachable from browser client trees must be exactly
 *                 whitelisted (clientBase ∪ runtimeClient.module) because the
 *                 capabilities host wildcard does not apply to client bundles
 *
 * Output: violation list then exit 1; when clean prints GUARD-OK and exits 0.
 *
 * Usage: node scripts/guards/guard-dsh-dependencies.mjs
 *        node scripts/guards/guard-dsh-dependencies.mjs --build-dsh
 *            structural-only mode: proves scripts/build-dsh.mjs consumes the
 *            shared fact/resolution rules and owns no duplicate
 *            exports.types/tsconfig package-resolution block (see the
 *            contract comment at that branch); prints BUILD-DSH-SINGLE-SOURCE-OK
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  TYPES_SANDBOX_PREFIX,
  deriveDshSource,
  deriveInject,
  deriveTsconfigPaths,
  isSpecifierCovered,
  readDependencyFacts,
  resolveTypesDeclaration,
} from '../sync-dsh-dependencies.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const violations = []
function check(ok, message) {
  if (!ok) violations.push(message)
}

// --- --build-dsh: build:dsh single-source structural contract ----------------
// Guarded contract: scripts/build-dsh.mjs (the npm type-sandbox rewrite) must
// not own a second copy of the dependency rules. Its install list comes from
// config/dsh-dependencies.json via readDependencyFacts, each configured
// specifier resolves through the shared exports.types resolver
// (resolveConfiguredTypePaths), and the tsconfig paths block is rewritten with
// the shared seed derivation (deriveTsconfigPaths). The former local block —
// scanning tsconfig path keys for @deepseek-ai packages and probing installed
// manifests' exports maps by hand — must stay deleted. These checks are
// deliberately text-level and not a behavior test: they reconcile WHICH MODULE
// OWNS the resolution logic, a property no behavioral run can prove without
// performing a real pnpm install.
if (process.argv.includes('--build-dsh')) {
  const text = readFileSync(join(root, 'scripts', 'build-dsh.mjs'), 'utf8')
  check(
    /from\s+'\.\.\/sync-dsh-dependencies\.mjs'|from\s+'\.\/sync-dsh-dependencies\.mjs'/.test(text),
    'scripts/build-dsh.mjs must import its fact/resolution rules from scripts/sync-dsh-dependencies.mjs',
  )
  for (const rule of ['readDependencyFacts', 'resolveConfiguredTypePaths', 'deriveTsconfigPaths']) {
    check(
      new RegExp(`\\b${rule}\\b`).test(text),
      `scripts/build-dsh.mjs must consume the shared ${rule} rule`,
    )
  }
  // Absence half of the contract: none of the fingerprints of the removed
  // duplicate exports.types/tsconfig package-resolution block may reappear.
  for (const [pattern, description] of [
    [/exportEntry|\.exports\?\./, 'local exports-map probing (manifest.exports / exportEntry)'],
    [/\?\.\s*types\b/, "local exports 'types' condition handling"],
    [/readFileSync\([^)]*['"]package\.json['"]/, "reading an installed package's manifest locally"],
    [/paths \?\? \{\}/, 'scanning the tsconfig paths keys as a package list'],
    [/startsWith\(['"]@deepseek-ai\/['"]\)/, 'filtering tsconfig keys by @deepseek-ai prefix'],
  ]) {
    check(
      !pattern.test(text),
      `scripts/build-dsh.mjs must not own ${description}; use the shared rules in scripts/sync-dsh-dependencies.mjs`,
    )
  }
  if (violations.length > 0) {
    console.log(`VIOLATIONS build-dsh single-source (${violations.length}):`)
    for (const v of violations) console.log(`  ${v}`)
    process.exit(1)
  }
  console.log('BUILD-DSH-SINGLE-SOURCE-OK')
  process.exit(0)
}

const facts = readDependencyFacts(root)

// --- 1. pin: generated dsh-source.json -------------------------------------
check(
  JSON.stringify(JSON.parse(readFileSync(join(root, 'dsh-source.json'), 'utf8')))
    === JSON.stringify(deriveDshSource(facts)),
  'dsh-source.json does not match config.runtime (run scripts/sync-dsh-dependencies.mjs)',
)

// --- 2. inject: package.json manifest ---------------------------------------
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
check(
  JSON.stringify(manifest.dsh?.client?.inject) === JSON.stringify(deriveInject(facts)),
  'package.json dsh.client.inject does not match config.inject',
)

// --- 3. tsconfig: seeded paths ---------------------------------------------
const tsconfig = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'))
check(
  JSON.stringify(tsconfig.compilerOptions?.paths) === JSON.stringify(deriveTsconfigPaths(facts)),
  'tsconfig.json compilerOptions.paths do not match the config.typePackages seeds',
)
// When the pinned type sandbox is installed, every seed must still resolve
// through the package's own exports.types (clean checkouts skip this probe).
const sandboxNodeModules = join(root, TYPES_SANDBOX_PREFIX.slice('./'.length))
if (existsSync(sandboxNodeModules)) {
  for (const [specifier, declaration] of Object.entries(facts.typePackages)) {
    const resolved = resolveTypesDeclaration(sandboxNodeModules, specifier)
    check(
      resolved === declaration,
      `typePackages[${specifier}] no longer resolves through exports.types (expected ${declaration}, got ${String(resolved)}); re-run \`pnpm run build:dsh\` then \`node scripts/sync-dsh-dependencies.mjs --sync-types\``,
    )
  }
} else {
  console.log('type sandbox not installed; skipping exports.types resolution probe')
}

// --- 4. chain: inject ⊆ patch inserts ⊆ BUNDLED_* ---------------------------
const patch = parseYaml(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'))
const insertNames = (Array.isArray(patch) ? patch : [])
  .flatMap(entry => Array.isArray(entry?.insert) ? entry.insert : [])
  .map(row => row?.name)
  .filter(name => typeof name === 'string')
const profile = await import(pathToFileURL(join(root, 'src', 'profile.ts')).href)
for (const name of insertNames) {
  check(
    profile.BUNDLED_DESKTOP_PLUGINS.includes(name),
    `cordis.patch.yml insert ${name} is not a BUNDLED_DESKTOP_PLUGINS member`,
  )
  check(
    name === '@dsh-studio/capabilities'
      ? profile.BUNDLED_DESKTOP_HOST_PLUGINS.includes(name)
      : profile.BUNDLED_DESKTOP_CLIENT_PLUGINS.includes(name),
    `cordis.patch.yml insert ${name} sits in the wrong BUNDLED_DESKTOP_* track`,
  )
}
for (const name of facts.inject) {
  if (name.startsWith('@dsh-studio/')) {
    check(
      insertNames.includes(name),
      `inject entry ${name} is not inserted by cordis.patch.yml`,
    )
  } else {
    // Official modules are injected by name into the DSH client shell and are
    // provided at runtime by the pinned release recorded in config.runtime.
    check(
      name.startsWith('@deepseek-ai/'),
      `inject entry ${name} is neither a bundled studio plugin nor an official @deepseek-ai runtime module`,
    )
  }
}

// --- 5. bundles: upstream prefixes per surface ------------------------------
for (const [surface, exported] of [
  ['desktop', 'DESKTOP_BUNDLES'],
  ['web', 'WEB_BUNDLES'],
  ['tui', 'TUI_BUNDLES'],
]) {
  const actual = profile[exported]
  facts.bundles[surface].forEach((name, index) => {
    check(
      actual[index] === name,
      `profile.${exported}[${index}] is ${String(actual[index])}, expected upstream prefix ${name} from config.bundles.${surface}`,
    )
  })
}

// --- 6. externals coverage over repository sources ---------------------------
// Two-tier contract:
//   - Specifiers imported from browser client trees (plugins/*/src/client,
//     type-only statements stripped) must be EXACTLY whitelisted for client
//     builds (clientBase ∪ runtimeClient.module) — the capabilities host
//     wildcard does not apply there, so a new client import of any other
//     official package fails here instead of at bundle time.
//   - Every @deepseek-ai/* specifier anywhere must be covered by the full
//     whitelist union (including the hostCapabilities wildcards).
const SOURCE_ROOTS = [join(root, 'src'), join(root, 'plugins'), join(root, 'web', 'src')]
const IMPORT_RE = /(?:from\s+|import\s*\(|require\()\s*['"](@deepseek-ai\/[^'"]+)['"]/g
// Strip `import type …` / `export type …` statements: esbuild erases them, so
// they need no external entry.
const TYPE_STATEMENT_RE = /(?:import|export)\s+type\s[^'"]*['"][^'"]*['"]/g

function walkSources(dir, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules' || entry.name === '.cache') continue
      walkSources(full, out)
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function clientExactExternals(factsLocal) {
  return new Set([...factsLocal.externals.clientBase, factsLocal.externals.runtimeClient.module])
}

const imported = []
for (const sourceRoot of SOURCE_ROOTS) {
  if (!statSync(sourceRoot, { throwIfNoEntry: false })?.isDirectory()) continue
  for (const file of walkSources(sourceRoot, [])) {
    const text = readFileSync(file, 'utf8')
    const isClientSource = /[\\/]src[\\/]client[\\/]/.test(file.slice(root.length + 1))
    const specifiers = new Set()
    // Type-only statements are erased by esbuild, so classification scans the
    // stripped source only.
    for (const match of text.replace(TYPE_STATEMENT_RE, '').matchAll(IMPORT_RE)) {
      specifiers.add(match[1])
    }
    for (const specifier of specifiers) {
      imported.push({ specifier, file: file.slice(root.length + 1), isClientSource })
    }
  }
}

const clientExact = clientExactExternals(facts)
for (const { specifier, file, isClientSource } of imported) {
  if (isClientSource && !clientExact.has(specifier)) {
    violations.push(
      `client import ${specifier} (${file}) is not exactly whitelisted for client builds `
      + `(config externals.clientBase ∪ runtimeClient.module); `
      + `the capabilities host wildcard does not cover browser bundles`,
    )
  } else if (!isSpecifierCovered(facts, specifier)) {
    violations.push(`source import ${specifier} (${file}) is not covered by the externals whitelist`)
  }
}

// Positive controls proving both absence assertions above can fail:
//   1. the exact-client set rejects an unlisted specifier;
//   2. with every pattern removed, the coverage matcher rejects anything.
check(
  !clientExact.has('@deepseek-ai/dsh-dependencies-guard-positive-control'),
  'positive control failed: exact-client whitelist accepts arbitrary specifiers',
)
const emptyPatterns = {
  ...facts,
  externals: {
    ...facts.externals,
    clientBase: [],
    hostCapabilities: [],
    runtimeClient: { ...facts.externals.runtimeClient, module: '' },
  },
}
check(
  !isSpecifierCovered(emptyPatterns, '@deepseek-ai/dsh-tools'),
  'positive control failed: externals matcher accepts arbitrary specifiers',
)

if (violations.length > 0) {
  console.log(`VIOLATIONS guard-dsh-dependencies (${violations.length}):`)
  for (const v of violations) console.log(`  ${v}`)
  process.exit(1)
}
console.log(
  `guard-dsh-dependencies reconciled pin/inject/tsconfig/patch/profile/bundles `
  + `(${facts.inject.length} inject, ${Object.keys(facts.typePackages).length} typePackages, `
  + `${imported.length} distinct @deepseek-ai import sites covered)`,
)
// Pin single-source: the pnpm version is declared once (package.json
// packageManager) and mirrored byte-identically into dsh-source.json.
{
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const source = JSON.parse(readFileSync(join(root, 'dsh-source.json'), 'utf8'))
  const declared = typeof pkg.packageManager === 'string' ? pkg.packageManager : ''
  if (!declared.startsWith('pnpm@')) {
    console.error('package.json packageManager must pin a pnpm version, got:', declared)
    process.exit(1)
  }
  if (source.packageManager !== declared) {
    console.error(`pnpm pin drift: dsh-source.json=${String(source.packageManager)} vs package.json=${declared}`)
    process.exit(1)
  }
}
console.log('GUARD-OK')

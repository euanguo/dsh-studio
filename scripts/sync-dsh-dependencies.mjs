#!/usr/bin/env node
/**
 * sync-dsh-dependencies.mjs — generator over the single @deepseek-ai
 * dependency fact source, `config/dsh-dependencies.json`.
 *
 * Writable facts live ONLY in the config file:
 *   runtime       pinned DSH release (package/version/integrity/tarball/
 *                 packageManager)            → generated dsh-source.json
 *   inject        dsh.client.inject manifest → package.json `dsh.client.inject`
 *   externals     esbuild external whitelists consumed by scripts/build.mjs
 *   typePackages  tsconfig paths seeds       → tsconfig.json `paths` block
 *   bundles       upstream bundle prefix per surface (reconciled against
 *                 src/profile.ts by scripts/guards/guard-dsh-dependencies.mjs)
 *
 * The generated artifacts are physical duplicates allowed by the single-fact
 * rule; their write point is this config alone. Drift between config and
 * artifacts fails `--check` and scripts/guards/guard-dsh-dependencies.mjs.
 *
 * Derivation rules (fixture-covered in tests/dsh-dependencies.test.ts):
 *   - inject: written in declared config order (registration order is part of
 *     the fact); duplicates and non-strings are rejected.
 *   - tsconfig seeds: each typePackage specifier maps to exactly one
 *     declaration file inside the npm-types sandbox
 *     (.cache/dsh-source/npm-types/node_modules/<declaration>).
 *   - exports.types 解析: declarations resolve through a package's own
 *     `exports` map (string form or `types` condition), subpath or root.
 *     scripts/build-dsh.mjs reuses these same rules for its npm type-sandbox
 *     install list and tsconfig rewrite — it owns no second copy.
 *   - externals 白名单合成: every client bundle keeps clientBase external;
 *     plugins listed under externals.runtimeClient.plugins additionally keep
 *     the injected official runtime module external; only the capabilities
 *     host build keeps hostCapabilities external.
 *
 * Usage:
 *   node scripts/sync-dsh-dependencies.mjs             regenerate drifted artifacts
 *   node scripts/sync-dsh-dependencies.mjs --check     exit 1 on drift; SYNC-CLEAN when clean
 *   node scripts/sync-dsh-dependencies.mjs --sync-types
 *       Re-resolve every typePackages declaration through the pinned
 *       package's exports.types against the installed type sandbox
 *       (.cache/dsh-source/npm-types — run `pnpm run build:dsh` first) and
 *       rewrite config/dsh-dependencies.json. Tool-assisted update of the
 *       fact source after an upstream bump; never touches other sections.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))

/** Repository-relative location of the dependency fact source. */
export const FACTS_PATH = 'config/dsh-dependencies.json'

/** Repository root containing config/dsh-dependencies.json. */
export const repoRoot = join(scriptDir, '..')

/** Root of the installed client-type sandbox seeded into tsconfig paths. */
export const TYPES_SANDBOX_PREFIX = './.cache/dsh-source/npm-types/node_modules/'

function fail(message) {
  throw new Error(`${FACTS_PATH}: ${message}`)
}

function requireStringArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`)
  const seen = new Set()
  for (const entry of value) {
    if (typeof entry !== 'string' || entry === '') fail(`${label} entries must be non-empty strings`)
    if (seen.has(entry)) fail(`${label} contains duplicate entry ${entry}`)
    seen.add(entry)
  }
  return value
}

/**
 * Load and validate the dependency fact source.
 * @param rootDir - repository root (defaults to this checkout's root).
 */
export function readDependencyFacts(rootDir = repoRoot) {
  const raw = JSON.parse(readFileSync(join(rootDir, FACTS_PATH), 'utf8'))

  if (typeof raw.runtime !== 'object' || raw.runtime === null) fail('runtime must be an object')
  if (raw.runtime.source === 'npm') {
    for (const field of ['package', 'version', 'integrity', 'tarball', 'packageManager']) {
      if (typeof raw.runtime[field] !== 'string' || raw.runtime[field] === '') {
        fail(`runtime.${field} must be a non-empty string`)
      }
    }
  } else {
    for (const field of ['repository', 'ref', 'revision', 'version']) {
      if (typeof raw.runtime[field] !== 'string' || raw.runtime[field] === '') {
        fail(`runtime.${field} must be a non-empty string`)
      }
    }
  }

  if (!Array.isArray(raw.inject) || raw.inject.length === 0) fail('inject must be a non-empty array')
  requireStringArray(raw.inject, 'inject')

  const externals = raw.externals
  if (typeof externals !== 'object' || externals === null) fail('externals must be an object')
  requireStringArray(externals.clientBase, 'externals.clientBase')
  requireStringArray(externals.hostCapabilities, 'externals.hostCapabilities')
  const runtimeClient = externals.runtimeClient
  if (typeof runtimeClient !== 'object' || runtimeClient === null) fail('externals.runtimeClient must be an object')
  if (typeof runtimeClient.module !== 'string' || runtimeClient.module === '') {
    fail('externals.runtimeClient.module must be a non-empty string')
  }
  requireStringArray(runtimeClient.plugins, 'externals.runtimeClient.plugins')

  if (typeof raw.typePackages !== 'object' || raw.typePackages === null || Array.isArray(raw.typePackages)) {
    fail('typePackages must be an object mapping import specifiers to declaration files')
  }
  for (const [specifier, declaration] of Object.entries(raw.typePackages)) {
    if (!specifier.startsWith('@deepseek-ai/')) fail(`typePackages key ${specifier} is not an @deepseek-ai import`)
    if (typeof declaration !== 'string' || declaration === '') {
      fail(`typePackages[${specifier}] must name a declaration file`)
    }
    if (declaration.startsWith('/') || declaration.startsWith('.') || declaration.includes('\\')
      || declaration.split('/').includes('..')) {
      fail(`typePackages[${specifier}] must be a sandbox-relative path without traversal`)
    }
  }

  if (typeof raw.bundles !== 'object' || raw.bundles === null) fail('bundles must be an object')
  // Every packaged surface profile (src/profile.ts) owns an upstream prefix.
  for (const surface of ['desktop', 'web', 'tui']) {
    const list = raw.bundles[surface]
    if (!Array.isArray(list) || list.length === 0) fail(`bundles.${surface} must be a non-empty array`)
    requireStringArray(list, `bundles.${surface}`)
  }

  return raw
}

/** Pinned-release manifest derived from the runtime pin facts. */
export function deriveDshSource(facts) {
  const runtime = facts.runtime
  if (runtime.source === 'npm') {
    return {
      source: 'npm',
      package: runtime.package,
      version: runtime.version,
      integrity: runtime.integrity,
      tarball: runtime.tarball,
      packageManager: runtime.packageManager,
    }
  }
  return {
    source: 'git',
    repository: runtime.repository,
    ref: runtime.ref,
    revision: runtime.revision,
    version: runtime.version,
  }
}

/** dsh.client.inject list in declared order (order is part of the fact). */
export function deriveInject(facts) {
  return [...facts.inject]
}

/**
 * Resolve a package's types file for one export subpath through its own
 * `exports` map. Accepts the string form (`"exports": { ".": "./lib/types/index.d.ts" }`)
 * and the condition form (`{ "types": "..." }`); returns null otherwise.
 * Ported from the former inline logic in scripts/build-dsh.mjs.
 */
export function resolveTypesEntry(pkgExports, subpath) {
  if (typeof pkgExports !== 'object' || pkgExports === null) return null
  const key = subpath === '' ? '.' : `./${subpath}`
  const entry = pkgExports[key]
  if (typeof entry === 'string') return entry
  if (typeof entry?.types === 'string') return entry.types
  return null
}

/**
 * Resolve one @deepseek-ai import specifier to its declaration path inside an
 * installed packages tree (the npm-types sandbox's node_modules), via
 * exports.types. Returns `<pkg>/<types-path>` with posix separators, or null
 * when the manifest/exports/file do not resolve.
 */
export function resolveTypesDeclaration(packagesRoot, specifier) {
  const segments = specifier.split('/')
  const packageName = segments.slice(0, 2).join('/')
  const subpath = segments.slice(2).join('/')
  const packageDir = join(packagesRoot, packageName)
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
  const typesPath = resolveTypesEntry(manifest.exports, subpath)
  if (typesPath === null) return null
  const candidate = join(packageDir, typesPath)
  if (!existsSync(candidate)) return null
  return `${packageName}/${relative(packageDir, candidate).split('\\').join('/')}`
}

/** tsconfig `paths` seed block derived from the typePackages facts. */
export function deriveTsconfigPaths(facts) {
  const paths = {}
  for (const [specifier, declaration] of Object.entries(facts.typePackages)) {
    paths[specifier] = [`${TYPES_SANDBOX_PREFIX}${declaration}`]
  }
  return paths
}

/** Whether one import specifier is satisfied by the configured externals. */
export function isSpecifierCovered(facts, specifier) {
  const patterns = [
    ...facts.externals.clientBase,
    ...facts.externals.hostCapabilities,
    facts.externals.runtimeClient.module,
  ]
  return patterns.some((pattern) => pattern.endsWith('/*')
    ? specifier.startsWith(pattern.slice(0, -1))
    : pattern === specifier)
}

/** Host-build externals for one plugin directory (capabilities gateway only). */
export function hostExternalsFor(facts, pluginDirectory) {
  return pluginDirectory === 'capabilities' ? [...facts.externals.hostCapabilities] : []
}

/**
 * Externals shared by every browser bundle, including lazy chunks served
 * outside the per-plugin client graph.
 */
export function clientBaseExternals(facts) {
  return [...facts.externals.clientBase]
}

/** Client-build externals for one plugin directory. */
export function clientExternalsFor(facts, pluginDirectory) {
  const externals = [...facts.externals.clientBase]
  if (facts.externals.runtimeClient.plugins.includes(pluginDirectory)) {
    externals.push(facts.externals.runtimeClient.module)
  }
  return externals
}

function jsonText(value) {
  return `${JSON.stringify(value, undefined, 2)}\n`
}

/** Generated artifact contents computed from the current fact source. */
function plannedArtifacts(rootDir, facts) {
  const tsconfig = JSON.parse(readFileSync(join(rootDir, 'tsconfig.json'), 'utf8'))
  tsconfig.compilerOptions.paths = deriveTsconfigPaths(facts)
  const manifest = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
  manifest.dsh ??= {}
  manifest.dsh.client ??= {}
  manifest.dsh.client.inject = deriveInject(facts)
  return [
    { file: 'dsh-source.json', next: jsonText(deriveDshSource(facts)) },
    { file: 'tsconfig.json', next: jsonText(tsconfig) },
    { file: 'package.json', next: jsonText(manifest) },
  ]
}

/**
 * Resolve every configured typePackages specifier through the installed
 * sandbox's node_modules via exports.types. Returns `{ resolved, missing }`:
 * `resolved` maps each specifier to its posix `<pkg>/<types-path>` declaration,
 * `missing` lists the specifiers that did not resolve. Shared by the
 * `--sync-types` fact refresh and scripts/build-dsh.mjs's tsconfig rewrite.
 */
export function resolveConfiguredTypePaths(packagesRoot, facts) {
  const resolved = {}
  const missing = []
  for (const specifier of Object.keys(facts.typePackages)) {
    const declaration = resolveTypesDeclaration(packagesRoot, specifier)
    if (declaration === null) missing.push(specifier)
    else resolved[specifier] = declaration
  }
  return { resolved, missing }
}

function syncTypesFacts(rootDir, facts) {
  const packagesRoot = join(rootDir, TYPES_SANDBOX_PREFIX.slice('./'.length))
  const { resolved, missing } = resolveConfiguredTypePaths(packagesRoot, facts)
  if (missing.length > 0) {
    throw new Error(
      `${FACTS_PATH}: type sandbox does not resolve ${missing.length} specifiers `
      + `(install it with \`pnpm run build:dsh\` first):\n${missing.join('\n')}`)
  }
  return resolved
}

async function main(argv) {
  const rootDir = repoRoot
  if (argv.includes('--sync-types')) {
    const facts = readDependencyFacts(rootDir)
    const updated = { ...facts, typePackages: syncTypesFacts(rootDir, facts) }
    writeFileSync(join(rootDir, FACTS_PATH), jsonText(updated))
    console.log(`${FACTS_PATH}: re-resolved ${Object.keys(updated.typePackages).length} typePackages through exports.types`)
    return
  }
  const check = argv.includes('--check')
  const facts = readDependencyFacts(rootDir)
  const drifted = plannedArtifacts(rootDir, facts)
    .filter(({ file, next }) => readFileSync(join(rootDir, file), 'utf8') !== next)
  if (drifted.length === 0) {
    console.log('SYNC-CLEAN')
    return
  }
  if (check) {
    console.error(`${FACTS_PATH}: generated artifacts drifted from the fact source:`)
    for (const { file } of drifted) console.error(`  ${file}`)
    process.exitCode = 1
    return
  }
  for (const { file, next } of drifted) {
    writeFileSync(join(rootDir, file), next)
    console.log(`regenerated ${file}`)
  }
  console.log(`synced ${drifted.length} artifact(s) from ${FACTS_PATH}`)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

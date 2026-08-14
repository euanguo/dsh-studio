/**
 * Generic official-plugin vendor tool. One recipe for any future
 * `@deepseek-ai/dsh-client-*` migration — see docs/official-plugin-migration.md.
 *
 * Subcommands (run from the repo root):
 *   node scripts/vendor-plugin.mjs copy <official-dir> <plugin-dir>
 *       Copy official src/ into plugins/<plugin-dir>/src (excludes tests).
 *   node scripts/vendor-plugin.mjs pkg <plugin-dir> [--official <official-dir>]
 *       Print a package.json skeleton: dsh.client.inject copied from the
 *       official manifest, exports ./client + ./package.json.
 *   node scripts/vendor-plugin.mjs scan <plugin-dir>
 *       Print the plugin's external-module import map (what the bundle must
 *       keep external vs inline, and which need tsconfig paths).
 *   node scripts/vendor-plugin.mjs types <plugin-dir>
 *       Print the tsconfig `paths` block mapping externals to the OFFICIAL
 *       built lib/types/**\/*.d.ts (types and runtime share one source).
 *   node scripts/vendor-plugin.mjs write-types <plugin-dir>
 *       Merge that block into tsconfig.json (idempotent, marker-guarded).
 *   node scripts/vendor-plugin.mjs externals <plugin-dir>
 *       Print esbuild external entries for build-config.mjs.
 *   node scripts/vendor-plugin.mjs patch <official-id> <our-id> <our-name>
 *       Print the cordis.patch.yml rows (disable official + insert ours).
 *
 * `official-dir` is a package name (e.g. `ui-workspace`) resolved against
 * `.cache/dsh-source/<commit>/packages/client/<name>`.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, cpSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ---------------------------- official source ---------------------------- */

/** The single vendored official monorepo checkout (web-app pins its commit). */
export function officialSourceDir() {
  const cache = join(root, '.cache', 'dsh-source')
  if (!existsSync(cache)) throw new Error('vendor-plugin: missing .cache/dsh-source')
  const commits = readdirSync(cache)
    .filter(entry => statSync(join(cache, entry)).isDirectory())
    .filter(entry => existsSync(join(cache, entry, 'packages', 'client')))
  if (commits.length !== 1) {
    throw new Error(`vendor-plugin: expected exactly one dsh-source checkout, found ${commits.join(', ')}`)
  }
  return join(cache, commits[0])
}

/** Recursive package.json name → dir index over the vendored monorepo. */
let officialIndexCache = null
function officialIndex() {
  if (officialIndexCache !== null) return officialIndexCache
  const index = new Map()
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (['node_modules', 'lib', 'dist', '.git'].includes(entry)) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (entry !== 'package.json') continue
      try {
        const name = JSON.parse(readFileSync(full, 'utf8')).name
        if (typeof name === 'string') index.set(name, dirname(full))
      } catch { /* unparseable manifest: skip */ }
    }
  }
  walk(join(officialSourceDir(), 'packages'))
  officialIndexCache = index
  return index
}

/** Resolve `@deepseek-ai/<pkg>` to the vendored package directory. */
export function officialPackageDir(pkgName) {
  const dir = officialIndex().get(pkgName)
  if (dir !== undefined) return dir
  throw new Error(`vendor-plugin: no vendored package named "${pkgName}"`)
}

/* ------------------------------- imports -------------------------------- */

const IMPORT_RE = /(?:from\s+|import\s*\(|require\()\s*['"](@deepseek-ai\/[a-z0-9._/-]+|dsh-client-[a-z0-9._/-]+)['"]/g

/** All external package specifiers a plugin's src imports. */
export function scanImports(pluginDir) {
  const srcDir = join(root, 'plugins', pluginDir, 'src')
  const found = new Set()
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.(ts|tsx|mjs|js)$/.test(entry)) continue
      const source = readFileSync(full, 'utf8')
      for (const match of source.matchAll(IMPORT_RE)) found.add(match[1])
    }
  }
  walk(srcDir)
  return [...found].sort()
}

/** The frozen platform seed words (web/src/platform.ts) — always external. */
const PLATFORM_SEEDS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

/** Split a specifier into `{ pkg, sub }` (sub = '' | '/client' | '/remote' …). */
function splitSpec(spec) {
  if (!spec.startsWith('@deepseek-ai/')) return { pkg: spec, sub: '' }
  const parts = spec.split('/')
  return { pkg: parts.slice(0, 2).join('/'), sub: `/${parts.slice(2).join('/')}` }
}

/** Whether a specifier is a vendored client package (registerable/external). */
export function isVendoredClientPackage(spec) {
  const { pkg } = splitSpec(spec)
  try { officialPackageDir(pkg); return true } catch { return false }
}

/* -------------------------------- commands ------------------------------- */

function cmdCopy(args) {
  const [official, target] = args
  if (official === undefined || target === undefined) throw new Error('copy <official-dir> <plugin-dir>')
  const officialPkg = officialPackageDir(`@deepseek-ai/dsh-client-${official}`)
    .catch?.() ?? null
  const dir = existsSync(join(officialSourceDir(), 'packages', 'client', official))
    ? join(officialSourceDir(), 'packages', 'client', official)
    : officialPkg
  if (!existsSync(dir)) throw new Error(`vendor-plugin: unknown official package "${official}"`)
  const src = join(dir, 'src')
  const targetSrc = join(root, 'plugins', target, 'src')
  cpSync(src, targetSrc, {
    recursive: true,
    filter: (from) => {
      const rel = from.slice(src.length + 1)
      return !/\.test\.|__tests__|tests?[\\/]|\.spec\.|\.test\./.test(rel)
    },
  })
  console.log(`copied ${dir}/src → ${targetSrc} (tests excluded)`)
  return true
}

function cmdPkg(args) {
  const [target] = args
  if (target === undefined) throw new Error('pkg <plugin-dir> [--official <name>]')
  const officialIdx = args.indexOf('--official')
  const official = officialIdx !== -1 ? args[officialIdx + 1] : target
  const officialPkg = JSON.parse(
    readFileSync(join(officialSourceDir(), 'packages', 'client', official, 'package.json'), 'utf8'),
  )
  const inject = officialPkg.dsh?.client?.inject ?? []
  console.log(JSON.stringify({
    name: `@oh-dsh/${target}`,
    version: '0.1.0',
    private: true,
    type: 'module',
    dsh: { client: { inject, platform: 'web', immediately: true } },
    exports: {
      '.': './src/index.ts',
      './client': './src/client.ts',
      './package.json': './package.json',
    },
  }, null, 2))
  return true
}

function cmdScan(args) {
  const [target] = args
  if (target === undefined) throw new Error('scan <plugin-dir>')
  for (const spec of scanImports(target)) {
    const vendored = isVendoredClientPackage(spec)
    const platform = PLATFORM_SEEDS.includes(spec)
    console.log(`${spec}\t${platform ? 'platform-external' : vendored ? 'client-external' : 'inline'}`)
  }
  return true
}

/** Resolve a package's types file for a specifier subpath, via the package's
 *  own `exports` map (falling back to lib/types/<sub>.d.ts). */
function typesFileFor(pkgDir, pkg, sub) {
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  const key = sub === '' ? '.' : `.${sub}`
  const entry = pkgJson.exports?.[key]
  if (entry !== undefined) {
    const types = typeof entry === 'string' ? entry : entry?.types
    if (typeof types === 'string') {
      const candidate = join(pkgDir, types)
      if (existsSync(candidate)) return candidate
    }
  }
  const flat = join(pkgDir, 'lib', 'types', `${sub.slice(1)}.d.ts`)
  if (existsSync(flat)) return flat
  return join(pkgDir, 'lib', 'types', sub.slice(1), 'index.d.ts')
}

/** Import specifiers found inside one declaration file. */
const DTS_IMPORT_RE = /(?:from|import\s*\(|require\()\s*['"](@deepseek-ai\/[^'"]+)['"]/g

/**
 * Map an entry .d.ts to tsconfig paths, following the package's own
 * `@deepseek-ai/*` imports transitively (official types re-export across
 * packages — e.g. runtime re-exports SessionId from dsh-client-connection).
 */
function collectTypeClosure(entryDts, paths, visited) {
  const queue = [entryDts]
  while (queue.length > 0) {
    const dts = queue.shift()
    const source = readFileSync(dts, 'utf8')
    for (const match of source.matchAll(DTS_IMPORT_RE)) {
      const spec = match[1]
      if (visited.has(spec)) continue
      visited.add(spec)
      if (!isVendoredClientPackage(spec)) continue
      const { pkg, sub } = splitSpec(spec)
      const pkgDir = officialPackageDir(pkg)
      const target = typesFileFor(pkgDir, pkg, sub)
      if (!existsSync(target)) {
        console.error(`vendor-plugin: no types for "${spec}" (${target}) — skipped`)
        continue
      }
      paths[spec] = [`./${target.replace(`${root}/`, '')}`]
      queue.push(target)
    }
  }
}

function cmdTypes(args) {
  const [target] = args
  if (target === undefined) throw new Error('types <plugin-dir>')
  const paths = {}
  const visited = new Set()
  for (const spec of scanImports(target)) {
    if (!isVendoredClientPackage(spec)) continue
    if (visited.has(spec)) continue
    visited.add(spec)
    const { pkg, sub } = splitSpec(spec)
    const pkgDir = officialPackageDir(pkg)
    const dts = typesFileFor(pkgDir, pkg, sub)
    if (!existsSync(dts)) {
      console.error(`vendor-plugin: no types for "${spec}" (${dts}) — skipped`)
      continue
    }
    // tsconfig paths entries must be relative to the config file (repo root)
    // and must NOT start with a bare package name (TS5090 without baseUrl).
    paths[spec] = [`./${dts.replace(`${root}/`, '')}`]
    collectTypeClosure(dts, paths, visited)
  }
  console.log(JSON.stringify({ compilerOptions: { paths } }, null, 2))
  return paths
}

function cmdWriteTypes(args) {
  const paths = cmdTypes(args)
  const tsconfigPath = join(root, 'tsconfig.json')
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'))
  tsconfig.compilerOptions.paths = {
    ...(tsconfig.compilerOptions.paths ?? {}),
    ...paths,
  }
  writeFileSync(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`)
  console.log(`tsconfig.json: merged ${Object.keys(paths).length} path entries`)
  return true
}

function cmdExternals(args) {
  const [target] = args
  if (target === undefined) throw new Error('externals <plugin-dir>')
  for (const spec of scanImports(target)) {
    if (PLATFORM_SEEDS.includes(spec) || isVendoredClientPackage(spec)) {
      console.log(`'${spec}',`)
    }
  }
  return true
}

function cmdPatch(args) {
  const [officialId, ourId, ourName] = args
  if (officialId === undefined || ourId === undefined || ourName === undefined) {
    throw new Error('patch <official-id> <our-id> <our-name>')
  }
  console.log(`- id: ${officialId}
  disabled: true
- insert:
    - id: ${ourId}
      name: '${ourName}'`)
  return true
}

/* --------------------------------- main ---------------------------------- */

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, ...rest] = process.argv.slice(2)
  const handlers = {
    copy: cmdCopy, pkg: cmdPkg, scan: cmdScan, types: cmdTypes,
    'write-types': cmdWriteTypes, externals: cmdExternals, patch: cmdPatch,
  }
  const handler = handlers[command]
  if (handler === undefined) {
    console.error(`vendor-plugin: unknown command "${command ?? ''}"`)
    console.error('commands: copy | pkg | scan | types | write-types | externals | patch')
    process.exit(2)
  }
  try {
    handler(rest)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

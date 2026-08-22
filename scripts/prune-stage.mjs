import {
  chmodSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Prune staged runtime trees before packaging.
 *
 * The packaged app only executes third-party code through Node's runtime
 * entry semantics. Everything the resolver can never reach — declaration
 * files, dev-only directories, `src/` trees no runtime condition references,
 * `esm`/`esnext`/`cjs` build variants outside the Node reachable set,
 * orphaned `.dsh-studio-store` entries, and the Node distribution's
 * compile-time payload — is dead weight in the install image. Source maps
 * are deliberately KEPT: they are the only symbolication aid for production
 * errors, so they are never removed here.
 *
 * Reachability mirrors Node's own resolver: exports conditions only match
 * `node` / `import` / `require` / `default`, plus the legacy `main` field.
 * The `module` field and `source`/`types`/`browser` conditions are build-time
 * only and never contribute runtime paths.
 */

const DEV_DIRECTORIES = new Set([
  '.github',
  '.husky',
  '.idea',
  '.vscode',
  '.yarn',
  'examples',
  'example',
  'test',
  'tests',
  '__tests__',
])

/**
 * Build variant directory names that are duplicates of the reachable build.
 * Only `esm`/`esnext` alias copies are ever candidates, and only as children
 * of a reachable directory (the OTel build/esm style); cjs and other
 * directories may be internal-require targets and are never stripped.
 */
const VARIANT_DIRECTORIES = new Set(['esm', 'esnext'])

/** Condition names a Node.js runtime can reach through an exports map. */
const NODE_CONDITIONS = new Set(['node', 'import', 'require', 'default'])

/** Condition names only build-time consumers (bundlers/type-checkers) use. */
const BUILD_ONLY_EXPORT_KEYS = new Set(['source', 'types', 'browser'])

const EMPTY_STATS = () => ({
  declarationBytes: 0,
  declarationFiles: 0,
  devDirectoryBytes: 0,
  srcTreeBytes: 0,
  variantBytes: 0,
  storeEntriesRemoved: 0,
  nodeDietBytes: 0,
})

/** Collect every Node-reachable entry string from a manifest. */
function runtimeEntryStrings(manifest, out = []) {
  // Exports maps nest subpaths (depth 0) around condition sets (depth 1).
  // Node resolves conditions from NODE_CONDITIONS only; everything else
  // ("module", "esnext", "browser", ...) is a bundler/type-checker lane.
  const collect = (value, depth) => {
    if (typeof value === 'string') {
      out.push(value)
      return
    }
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) collect(item, depth)
      return
    }
    for (const [key, child] of Object.entries(value)) {
      if (depth === 1 && !NODE_CONDITIONS.has(key)) continue
      if (depth >= 2 && BUILD_ONLY_EXPORT_KEYS.has(key)) continue
      collect(child, depth + 1)
    }
  }
  collect(manifest.exports, 0)
  collect(manifest.main, 0)
  if (manifest.bin !== undefined) collect(manifest.bin, 0)
  return out
}

/** Whether any reachable entry string points into the named directory. */
function referencesDirectory(strings, name) {
  return strings.some(value => value === name || value.includes(`/${name}`) || value.includes(`${name}/`))
}

function readNearestManifest(packageRoot) {
  try {
    return JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  } catch {
    return {}
  }
}

function directorySize(path) {
  let total = 0
  const visit = directory => {
    let entries
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const candidate = join(directory, entry.name)
      if (entry.isDirectory()) visit(candidate)
      else if (entry.isFile()) {
        try { total += statSync(candidate).size } catch { /* raced */ }
      }
    }
  }
  visit(path)
  return total
}

function removeTree(path) {
  const bytes = directorySize(path)
  rmSync(path, { recursive: true, force: true })
  return bytes
}

/** True when a subtree carries native binaries or its own package roots. */
function isUnsafeToStrip(dir) {
  let unsafe = false
  const visit = directory => {
    if (unsafe) return
    let entries
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const candidate = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || existsSync(join(candidate, 'package.json'))) {
          unsafe = true
          return
        }
        visit(candidate)
      } else if (entry.isFile() && entry.name.endsWith('.node')) {
        unsafe = true
        return
      }
    }
  }
  visit(dir)
  return unsafe
}

/**
 * Strip runtime-unreachable payload from one staged dsh-runtime tree:
 * declaration files, dev-only directories, unreferenced `src/` trees,
 * unreachable build variants, and orphaned dependency-store entries.
 */
export function pruneRuntimeDependencies(runtimeRoot) {
  const stats = EMPTY_STATS()
  const moduleRoot = join(runtimeRoot, 'node_modules')
  const manifestCache = new Map()

  const walk = directory => {
    let entries
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (existsSync(join(path, 'package.json'))) {
          let manifest = manifestCache.get(path)
          if (manifest === undefined) {
            manifest = readNearestManifest(path)
            manifestCache.set(path, manifest)
          }
          const entryStrings = runtimeEntryStrings(manifest)
          // Legacy packages without an exports map resolve their real code
          // through main + internal relative requires (protobufjs ships
          // runtime code in src/, react-style packages in cjs/), so only
          // declared-entry packages are safe to surgically strip.
          const declaredEntries = manifest.exports !== undefined
          for (const dev of DEV_DIRECTORIES) {
            const candidate = join(path, dev)
            if (existsSync(candidate) && !referencesDirectory(entryStrings, dev)) {
              stats.devDirectoryBytes += removeTree(candidate)
            }
          }
          // A root-level main (index.js at the package root) is often a thin
          // wrapper that internally requires ./src/... (koffi, protobufjs),
          // so src/ is only safe to strip when every reachable entry lives
          // in a subdirectory (stainless-style: esm/lib) and src is
          // unreferenced.
          const rootLevelEntry = entryStrings.some(value => dirname(value) === '.')
          const sourceTree = join(path, 'src')
          if (declaredEntries && !rootLevelEntry
            && existsSync(sourceTree) && !referencesDirectory(entryStrings, 'src')) {
            stats.srcTreeBytes += removeTree(sourceTree)
          }
          if (declaredEntries) stripVariants(path, entryStrings, stats)
        }
        // A package can nest real node_modules (e.g. inside .pnpm copies).
        walk(path)
        continue
      }
      if (entry.isFile() && /\.d\.(?:cts|mts|ts)$/.test(entry.name)) {
        let size = 0
        try { size = statSync(path).size } catch { continue }
        rmSync(path, { force: true })
        stats.declarationBytes += size
        stats.declarationFiles += 1
      }
    }
  }
  walk(moduleRoot)

  // Sweep orphaned entries from the shared runtime dependency store.
  const storeRoot = join(moduleRoot, '.dsh-studio-store')
  if (existsSync(storeRoot)) {
    const referenced = new Set()
    const visitLinks = directory => {
      let entries
      try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const path = join(directory, entry.name)
        if (entry.isSymbolicLink()) {
          const raw = readlinkSync(path)
          const target = isAbsolute(raw) ? raw : resolve(dirname(path), raw)
          const storeMarker = `${sep}.dsh-studio-store${sep}`
          const at = target.indexOf(storeMarker)
          if (at !== -1) {
            const entryName = target.slice(at + storeMarker.length).split(sep, 1)[0]
            if (entryName !== '') referenced.add(entryName)
          }
          continue
        }
        if (entry.isDirectory()) visitLinks(path)
      }
    }
    visitLinks(moduleRoot)
    for (const entry of readdirSync(storeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (!referenced.has(entry.name)) {
        stats.storeEntriesRemoved += 1
        removeTree(join(storeRoot, entry.name))
      }
    }
  }
  return stats
}

/**
 * Remove unreferenced esm/esnext alias trees whose parent directory carries
 * the package's real (referenced) build output — e.g. OTel's
 * build/esm + build/esnext duplicating the referenced build/src. Variants at
 * the package root or under unreferenced parents are left alone: they may be
 * internal-require targets invisible to the exports map.
 */
function stripVariants(packageRoot, entryStrings, stats) {
  const visit = directory => {
    let entries
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
    const parentReferenced = directory === packageRoot
      ? false
      : referencesDirectory(entryStrings, directory.split(sep).pop() ?? '')
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const candidate = join(directory, entry.name)
      if (VARIANT_DIRECTORIES.has(entry.name)) {
        if (parentReferenced
          && !referencesDirectory(entryStrings, entry.name)
          && !isUnsafeToStrip(candidate)) {
          stats.variantBytes += removeTree(candidate)
        }
        continue
      }
      if (entry.name === 'node_modules') continue
      visit(candidate)
    }
  }
  visit(packageRoot)
}

/**
 * Remove compile-time and package-manager payload from the staged Node
 * distribution. `bin/node` always survives — every surface (Desktop, Web,
 * TUI) shares the same pinned standalone Node; there is no second runtime.
 */
export function dietNodeRuntime(nodeRuntime, _options = {}) {
  const stats = EMPTY_STATS()
  const remove = path => {
    if (!existsSync(path)) return
    stats.nodeDietBytes += removeTree(path)
  }
  const removeFile = path => {
    let stat
    try { stat = lstatSync(path) } catch { return }
    if (stat.isSymbolicLink()) { rmSync(path, { force: true }); return }
    stats.nodeDietBytes += stat.size
    rmSync(path, { force: true })
  }
  remove(join(nodeRuntime, 'include'))
  remove(join(nodeRuntime, 'lib', 'node_modules', 'npm'))
  remove(join(nodeRuntime, 'node_modules', 'npm'))
  remove(join(nodeRuntime, 'share'))
  removeFile(join(nodeRuntime, 'bin', 'npm'))
  removeFile(join(nodeRuntime, 'bin', 'npx'))
  remove(join(nodeRuntime, 'CHANGELOG.md'))
  remove(join(nodeRuntime, 'README.md'))
  return stats
}

/**
 * Replace the standalone Node binary with the shared-Node bridge for the
 * packaged desktop app: `bin/node` becomes a script that re-executes the
 * packaged Electron executable with ELECTRON_RUN_AS_NODE=1. The runtime
 * supervisor and marketplace spawn the interpreter directly via
 * process.execPath; this bridge exists for PATH-discovered consumers
 * (upstream `spawn("pnpm")`, CLI launchers, `env node` shebangs). Web/TUI
 * distributions keep the real binary and never call this.
 */
export function writeDesktopNodeBridge(nodeRuntime, targetExpression) {
  const shim = join(nodeRuntime, 'bin', 'node')
  const removed = existsSync(shim) || lstatSync(shim, { throwIfNoEntry: false }) !== undefined
  rmSync(shim, { force: true })
  writeFileSync(shim, [
    '#!/bin/sh',
    '# DSH Studio shared-Node bridge (Electron ELECTRON_RUN_AS_NODE).',
    'ELECTRON_RUN_AS_NODE=1',
    'export ELECTRON_RUN_AS_NODE',
    `exec "${targetExpression}" "$@"`,
    '',
  ].join('\n'))
  chmodSync(shim, 0o755)
  return removed
}

export function summarize(stats) {
  const parts = []
  if (stats.declarationBytes > 0) {
    parts.push(`declarations ${(stats.declarationBytes / 1024 / 1024).toFixed(1)} MB (${String(stats.declarationFiles)} files)`)
  }
  if (stats.devDirectoryBytes > 0) {
    parts.push(`dev dirs ${(stats.devDirectoryBytes / 1024 / 1024).toFixed(1)} MB`)
  }
  if (stats.srcTreeBytes > 0) {
    parts.push(`unreferenced src ${(stats.srcTreeBytes / 1024 / 1024).toFixed(1)} MB`)
  }
  if (stats.variantBytes > 0) {
    parts.push(`unreachable variants ${(stats.variantBytes / 1024 / 1024).toFixed(1)} MB`)
  }
  if (stats.storeEntriesRemoved > 0) {
    parts.push(`${String(stats.storeEntriesRemoved)} orphaned store entries`)
  }
  if (stats.nodeDietBytes > 0) {
    parts.push(`node diet ${(stats.nodeDietBytes / 1024 / 1024).toFixed(1)} MB`)
  }
  return parts.length > 0 ? `pruned ${parts.join(', ')}` : 'nothing to prune'
}

// Standalone verification entry: prune one staged dsh-runtime tree plus an
// optional node-runtime, printing a summary.
async function main() {
  const args = process.argv.slice(2)
  const runtimeArg = args[0]
  const nodeArg = args[1]
  if (runtimeArg === undefined) {
    console.error('usage: prune-stage.mjs <dsh-runtime dir> [node-runtime dir]')
    process.exitCode = 2
    return
  }
  const stats = { ...EMPTY_STATS(), ...pruneRuntimeDependencies(runtimeArg) }
  if (nodeArg !== undefined) {
    stats.nodeDietBytes = dietNodeRuntime(nodeArg).nodeDietBytes
  }
  console.log(summarize(stats))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main()
}

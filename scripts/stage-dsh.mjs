import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import {
  basename,
  delimiter,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DSH_SOURCE_SPEC, resolveDshSource, resolvePinnedPnpm } from './dsh-source.mjs'
import { dietNodeRuntime, pruneRuntimeDependencies, summarize } from './prune-stage.mjs'
import { assertRuntimeBudget, loadRuntimeContract } from './runtime-contract.mjs'
import { applyDshRuntimePatches } from './dsh-runtime-patches.mjs'
import { verifyStagedLayout } from './verify-staged-layout.mjs'
import { bakeSkinPalette } from './bake-skin-palette.mjs'
import { resolveNodeDistributionPlatform } from '../src/node-platform.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const npmRelease = DSH_SOURCE_SPEC.source === 'npm'
const dshSource = resolveDshSource()
const stage = join(root, '.stage')
const runtime = join(stage, 'dsh-runtime')
const nodeRuntime = join(stage, 'node-runtime')
const cache = join(root, '.cache')
// One Node version across every surface: the pinned Electron embeds the same
// release the standalone runtime distribution pins, so Desktop, Web, and TUI
// never run on divergent Node versions. The version and the size budgets that
// gate the staged tree live in config/runtime-contract.json (single source).
const runtimeContract = loadRuntimeContract()
const nodeVersion = process.env.DSH_STUDIO_NODE_VERSION ?? runtimeContract.runtime.nodeVersion
// Node.js distribution triples use `linux`/`darwin`/`win` and `x64`/`arm64`.
// Stage a Node runtime for the current host unless an override asks for a
// specific platform (used for cross-packaging).
const nodePlatform = resolveNodeDistributionPlatform()
const nodeArch = process.env.DSH_STUDIO_NODE_ARCH
  ?? { arm64: 'arm64', x64: 'x64' }[process.arch]
  ?? process.arch
const isWindowsNode = nodePlatform === 'win'
const nodeFolder = `node-v${nodeVersion}-${nodePlatform}-${nodeArch}`
const nodeArchiveName = `${nodeFolder}.${isWindowsNode ? 'zip' : 'tar.gz'}`
const nodeArchive = join(cache, nodeArchiveName)
const nodeCache = join(cache, nodeFolder)
const nodeExecutable = join(nodeCache, isWindowsNode ? 'node.exe' : join('bin', 'node'))

if (!npmRelease && (!existsSync(join(dshSource, 'apps', 'web', 'dist', 'index.html'))
  || !existsSync(join(dshSource, 'apps', 'cli', 'lib', 'bin.js')))) {
  throw new Error(`DSH build artifacts are missing at ${dshSource}; run pnpm run build:dsh first`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${String(result.status)}`)
  }
}

/** Create a portable link without allowing directory links in a Windows stage. */
function portableSymlink(target, link) {
  rmSync(link, { recursive: true, force: true })
  if (!isWindowsNode) {
    symlinkSync(target, link)
    return
  }
  const resolved = realpathSync(resolve(dirname(link), target))
  if (!lstatSync(resolved).isDirectory()) {
    copyFileSync(resolved, link)
    return
  }
  throw new Error(`Windows runtime contains an unexpected directory link: ${link} -> ${target}`)
}

function download(url, target) {
  const temporary = `${target}.download-${String(process.pid)}`
  rmSync(temporary, { force: true })
  run('curl', ['--fail', '--location', '--silent', '--show-error', url, '--output', temporary])
  rmSync(target, { force: true })
  writeFileSync(target, readFileSync(temporary))
  rmSync(temporary, { force: true })
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Expose pnpm's hoisted package graph for profile plugin resolution. */
function recordExposedDependencies() {
  const manifestPath = join(runtime, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const dependencies = { ...manifest.dependencies }
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const packagePath = join(realpathSync(path), 'package.json')
        if (!existsSync(packagePath)) continue
        const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8'))
        if (typeof packageManifest.name === 'string' && typeof packageManifest.version === 'string') {
          dependencies[packageManifest.name] = packageManifest.version
        }
      } else if (entry.isDirectory()) {
        const packagePath = join(path, 'package.json')
        if (existsSync(packagePath)) {
          const packageManifest = JSON.parse(readFileSync(packagePath, 'utf8'))
          if (typeof packageManifest.name === 'string' && typeof packageManifest.version === 'string') {
            dependencies[packageManifest.name] = packageManifest.version
          }
          continue
        }
        visit(path)
      }
    }
  }
  visit(join(runtime, 'node_modules'))
  manifest.dependencies = dependencies
  writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
}

function assertNodeMatchesElectron() {
  // Single source of truth for the runtime's Node version: the Electron
  // release this repo pins. When the build host can actually run the pinned
  // Electron binary (same OS family), verify the standalone Node version
  // matches Electron's embedded one and fail loudly on drift.
  const hostRunnable = isWindowsNode
    ? process.platform === 'win32'
    : process.platform === 'darwin' || process.platform === 'linux'
  const electronBinary = join(
    root, 'node_modules', 'electron', 'dist',
    isWindowsNode ? 'electron.exe' : join('Electron.app', 'Contents', 'MacOS', 'Electron'),
  )
  if (!hostRunnable || !existsSync(electronBinary)) return
  const result = spawnSync(electronBinary, ['-p', 'process.versions.node'], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  if (result.error !== undefined) {
    throw new Error(`cannot probe Electron Node version: ${result.error.message}`)
  }
  const embedded = (result.stdout ?? '').trim()
  if (embedded !== '' && embedded !== nodeVersion) {
    throw new Error(
      `Node version drift: runtime pins ${nodeVersion} but Electron embeds ${embedded}. `
      + 'Update nodeVersion in scripts/stage-dsh.mjs to match the pinned Electron.',
    )
  }
}

function ensureNodeRuntime() {
  assertNodeMatchesElectron()
  mkdirSync(cache, { recursive: true })
  const base = `https://nodejs.org/dist/v${nodeVersion}`
  const sumsPath = join(cache, `SHASUMS256-v${nodeVersion}.txt`)
  if (!existsSync(nodeArchive)) download(`${base}/${nodeArchiveName}`, nodeArchive)
  if (!existsSync(sumsPath)) download(`${base}/SHASUMS256.txt`, sumsPath)
  const expectedLine = readFileSync(sumsPath, 'utf8').split('\n')
    .find(line => line.endsWith(`  ${nodeArchiveName}`))
  if (expectedLine === undefined) throw new Error(`Node checksum entry missing for ${nodeArchiveName}`)
  const expected = expectedLine.split(/\s+/)[0]
  const actual = sha256(nodeArchive)
  if (actual !== expected) {
    throw new Error(`Node archive checksum mismatch: expected ${expected}, received ${actual}`)
  }
  if (!existsSync(nodeExecutable)) {
    const extraction = join(cache, `.node-extract-${String(process.pid)}`)
    rmSync(extraction, { recursive: true, force: true })
    mkdirSync(extraction, { recursive: true })
    if (isWindowsNode) {
      // bsdtar on the Windows runner unpacks zip archives.
      run('tar', ['-xf', nodeArchive, '-C', extraction])
    } else {
      run('tar', ['-xzf', nodeArchive, '-C', extraction])
    }
    rmSync(nodeCache, { recursive: true, force: true })
    cpSync(join(extraction, nodeFolder), nodeCache, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    })
    rmSync(extraction, { recursive: true, force: true })
  }
  if (!isWindowsNode) {
    for (const [name, target] of [
      ['npm', '../lib/node_modules/npm/bin/npm-cli.js'],
      ['npx', '../lib/node_modules/npm/bin/npx-cli.js'],
    ]) {
      const launcher = join(nodeCache, 'bin', name)
      rmSync(launcher, { force: true })
      symlinkSync(target, launcher)
    }
  }
  rmSync(nodeRuntime, { recursive: true, force: true })
  cpSync(nodeCache, nodeRuntime, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  })
  if (!isWindowsNode) chmodSync(join(nodeRuntime, 'bin', 'node'), 0o755)

  const pnpmSource = join(root, 'node_modules', 'pnpm')
  if (!existsSync(join(pnpmSource, 'dist', 'pnpm.mjs'))) {
    throw new Error('pnpm package is missing; run pnpm install before staging')
  }
  const pnpmTarget = join(
    nodeRuntime,
    isWindowsNode ? join('node_modules', 'pnpm') : join('lib', 'node_modules', 'pnpm'),
  )
  rmSync(pnpmTarget, { recursive: true, force: true })
  mkdirSync(pnpmTarget, { recursive: true })
  for (const name of ['bin', 'dist']) {
    cpSync(join(pnpmSource, name), join(pnpmTarget, name), {
      recursive: true,
      preserveTimestamps: true,
    })
  }
  for (const name of ['LICENSE', 'package.json']) {
    copyFileSync(join(pnpmSource, name), join(pnpmTarget, name))
  }
  if (isWindowsNode) {
    writeFileSync(
      join(nodeRuntime, 'pnpm.cmd'),
      '@ECHO off\r\n"%~dp0node.exe" "%~dp0node_modules\\pnpm\\bin\\pnpm.mjs" %*\r\n',
    )
  } else {
    const pnpmBinary = join(nodeRuntime, 'bin', 'pnpm')
    rmSync(pnpmBinary, { force: true })
    symlinkSync('../lib/node_modules/pnpm/bin/pnpm.mjs', pnpmBinary)
    chmodSync(join(pnpmTarget, 'bin', 'pnpm.mjs'), 0o755)
  }
}

function shouldCopyWorkspaceEntry(sourceRoot, source) {
  const rel = relative(sourceRoot, source)
  if (rel === '') return true
  const top = rel.split(sep)[0]
  return !new Set([
    '.git', '.agents', '.claude', 'node_modules', 'src', 'test', 'tests',
    'coverage', 'docs', 'website',
  ]).has(top)
}

/**
 * Whether the staged tree is an isolated-layout .pnpm virtual store (one
 * physical copy per package, top-level links). Hoisted deploys also keep a
 * small node_modules/.pnpm/lock.yaml, but materialize every package flat at
 * the node_modules root, so a store only counts when it contains package dirs.
 */
function isWithin(parent, candidate) {
  return candidate === parent || candidate.startsWith(parent + sep)
}

function discoverSourcePackages() {
  if (sourcePackages !== undefined) return sourcePackages
  const packages = new Map()
  const ignored = new Set([
    '.cache', '.git', '.pnpm-store', 'coverage', 'dist', 'docs', 'lib',
    'node_modules', 'src', 'test', 'tests', 'website',
  ])
  const visit = directory => {
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (typeof manifest.name === 'string') packages.set(manifest.name, directory)
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || ignored.has(entry.name) || entry.name.startsWith('.')
        || entry.name.startsWith('staging-')) continue
      visit(join(directory, entry.name))
    }
  }
  visit(dshSource)
  sourcePackages = packages
  return packages
}

function dependencyNames(manifest) {
  return new Map([
    ...Object.keys(manifest.peerDependencies ?? {}).map(name => [name, true]),
    ...Object.keys(manifest.optionalDependencies ?? {}).map(name => [name, true]),
    ...Object.keys(manifest.dependencies ?? {}).map(name => [name, false]),
  ])
}

function ensureWindowsWorkspacePackages() {
  const packages = discoverSourcePackages()
  const visited = new Set()
  const materialized = []

  const ensurePackage = name => {
    if (visited.has(name)) return
    visited.add(name)
    const source = packages.get(name)
    if (source === undefined) return
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    const target = runtimePackageDirectory(name)
    if (!packageMatches(target, manifest)) {
      const vendor = isWithin(join(dshSource, 'vendor'), source)
      rmSync(target, { recursive: true, force: true })
      mkdirSync(dirname(target), { recursive: true })
      cpSync(source, target, {
        recursive: true,
        preserveTimestamps: true,
        filter: candidate => {
          const rel = relative(source, candidate)
          if (rel === '') return true
          if (rel.split(sep)[0] === 'node_modules') return false
          return vendor || shouldCopyWorkspaceEntry(source, candidate)
        },
      })
      materialized.push(name)
    }
    for (const dependency of dependencyNames(manifest).keys()) {
      if (packages.has(dependency)) ensurePackage(dependency)
    }
  }

  const rootManifest = JSON.parse(readFileSync(join(dshSource, 'package.json'), 'utf8'))
  for (const dependency of dependencyNames(rootManifest).keys()) {
    if (packages.has(dependency)) ensurePackage(dependency)
  }
  for (const name of packages.keys()) {
    if (existsSync(runtimePackageDirectory(name))) ensurePackage(name)
  }
  console.log(`Windows workspace audit: materialized ${String(materialized.length)} missing packages`)
}

function findDeployedPackage(sourceTarget) {
  const manifestPath = join(sourceTarget, 'package.json')
  if (!existsSync(manifestPath)) return undefined
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return undefined
  const key = `${manifest.name}@${manifest.version}`
  if (deployedPackageTargets.has(key)) return deployedPackageTargets.get(key)
  if (existsSync(join(runtime, 'node_modules', ...manifest.name.split('/'), 'package.json'))) {
    const hoisted = join(runtime, 'node_modules', ...manifest.name.split('/'))
    deployedPackageTargets.set(key, hoisted)
    return hoisted
  }
  deployedPackageTargets.set(key, undefined)
  return undefined
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = join(store, entry.name, 'node_modules', ...manifest.name.split('/'))
    const candidateManifest = join(candidate, 'package.json')
    if (!existsSync(candidateManifest)) continue
    const deployed = JSON.parse(readFileSync(candidateManifest, 'utf8'))
    if (deployed.name === manifest.name && deployed.version === manifest.version) {
      deployedPackageTargets.set(key, candidate)
      return candidate
    }
  }
  deployedPackageTargets.set(key, undefined)
  return undefined
}

function stageDependencyTarget(sourceTarget) {
  const sourceStore = join(dshSource, 'node_modules', '.pnpm')
  if (isWithin(sourceStore, sourceTarget)) {
    const target = join(runtime, 'node_modules', '.pnpm', relative(sourceStore, sourceTarget))
    if (existsSync(target)) return target
    const equivalent = findDeployedPackage(sourceTarget)
    if (equivalent !== undefined) return equivalent
    throw new Error(`deployed pnpm store is missing runtime dependency: ${sourceTarget}`)
  }
  if (isWithin(dshSource, sourceTarget)) return stageWorkspaceTarget(sourceTarget)
  throw new Error(`DSH package dependency points outside the source checkout: ${sourceTarget}`)
}

function mirrorPackageDependencies(sourcePackage, targetPackage) {
  const manifestPath = join(sourcePackage, 'package.json')
  if (!existsSync(manifestPath)) return
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  for (const [dependency, optional] of dependencyNames(manifest)) {
    const sourceLink = join(sourcePackage, 'node_modules', ...dependency.split('/'))
    if (!existsSync(sourceLink)) {
      if (optional) continue
      throw new Error(`${manifest.name ?? sourcePackage} is missing installed dependency ${dependency}`)
    }
    const stat = lstatSync(sourceLink)
    if (!stat.isSymbolicLink()) {
      throw new Error(`${manifest.name ?? sourcePackage} dependency is not a pnpm link: ${sourceLink}`)
    }
    const sourceTarget = resolve(dirname(sourceLink), readlinkSync(sourceLink))
    const target = stageDependencyTarget(sourceTarget)
    const targetLink = join(targetPackage, 'node_modules', ...dependency.split('/'))
    mkdirSync(dirname(targetLink), { recursive: true })
    portableSymlink(relative(dirname(targetLink), target), targetLink)
  }
}

function stageWorkspaceTarget(source) {
  const rel = relative(dshSource, source)
  if (rel.startsWith(`..${sep}`) || rel === '..' || rel === '') {
    throw new Error(`cannot stage external DSH workspace target: ${source}`)
  }
  const existing = copiedTargets.get(source)
  if (existing !== undefined) return existing
  const target = join(runtime, 'workspace', rel)
  mkdirSync(dirname(target), { recursive: true })
  const stat = lstatSync(source)
  if (stat.isDirectory()) {
    cpSync(source, target, {
      recursive: true,
      preserveTimestamps: true,
      filter: candidate => shouldCopyWorkspaceEntry(source, candidate),
    })
  } else {
    copyFileSync(source, target)
  }
  copiedTargets.set(source, target)
  if (stat.isDirectory()) mirrorPackageDependencies(source, target)
  return target
}

const stagedVendorTargets = new Map()

/**
 * Copy one full vendored source directory once, mirroring how POSIX pnpm
 * deploy dereferences link: dependencies into real directories. The staged
 * layout must keep `src/` because vendored packages expose `./src/*` exports.
 */
function stageVendorTarget(source) {
  const existing = stagedVendorTargets.get(source)
  if (existing !== undefined) return existing
  const rel = relative(dshSource, source)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`cannot stage external vendor target: ${source}`)
  }
  const target = join(runtime, 'workspace', rel)
  rmSync(target, { recursive: true, force: true })
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
    filter: candidate => {
      const candidateRel = relative(source, candidate)
      return candidateRel === '' || candidateRel.split(sep)[0] !== 'node_modules'
    },
  })
  stagedVendorTargets.set(source, target)
  if (existsSync(join(source, 'node_modules'))) {
    mirrorPackageDependencies(source, target)
  }
  return target
}

/**
 * Recover a deployed link whose target is outside the source checkout.
 * pnpm's legacy deploy can leave link: overrides as junctions with stale
 * absolute targets on Windows; the source checkout keeps the same relative
 * entry, and vendored packages also exist under `vendor/<basename>`.
 */
function stageSourceCounterpart(link) {
  const sourceLink = join(dshSource, relative(runtime, link))
  let source = sourceLink
  if (existsSync(sourceLink)) {
    const stat = lstatSync(sourceLink)
    if (stat.isSymbolicLink()) {
      source = resolve(dirname(sourceLink), readlinkSync(sourceLink))
    }
  }
  if (!existsSync(source)) {
    source = join(dshSource, 'vendor', basename(link))
  }
  if (!existsSync(source)) {
    // The source checkout may simply not carry this package on the current
    // platform (e.g. an optional Linux/Windows native addon on macOS): skip
    // the dangling link instead of failing the whole stage.
    return undefined
  }
  if (!isWithin(dshSource, source)) {
    // Global-store content has no dependency links of its own; copy it
    // straight into the link location.
    rmSync(link, { recursive: true, force: true })
    cpSync(source, link, { recursive: true, dereference: true, preserveTimestamps: true })
    return undefined
  }
  return stageVendorTarget(source)
}

function walk(rootPath, visit) {
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const path = join(rootPath, entry.name)
    if (entry.isSymbolicLink()) visit(path)
    else if (entry.isDirectory()) walk(path, visit)
  }
}

/**
 * fetch-blob 3 imports the deprecated node-domexception shim for Node 12.
 * DSH Studio ships Node 26 and supports Node 24+, both of which expose the same
 * Web-standard DOMException globally. Patch only this reviewed import, then
 * remove the now-unreferenced shim from the portable runtime.
 */
function replaceDeprecatedDomExceptionShim() {
  // Flat hoisted layout: fetch-blob and the shim both live at the runtime
  // node_modules root; there is no virtual store to sweep.
  const dependency = 'node-domexception'
  const importPattern = /^import DOMException from ['"]node-domexception['"]\r?\n/m
  const fetchBlob = runtimePackageDirectory('fetch-blob')
  const sourcePath = join(fetchBlob, 'from.js')
  const manifestPath = join(fetchBlob, 'package.json')
  if (existsSync(sourcePath) && existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.dependencies?.[dependency] !== undefined) {
      const source = readFileSync(sourcePath, 'utf8')
      if (!importPattern.test(source)) {
        throw new Error('fetch-blob still depends on node-domexception through an unknown import')
      }
      writeFileSync(sourcePath, source.replace(importPattern, ''))
      delete manifest.dependencies[dependency]
      writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
    }
  }
  const hoisted = runtimePackageDirectory(dependency)
  const consumers = []
  walk(runtime, path => {
    if (basename(path) === dependency && path !== hoisted) consumers.push(path)
  })
  if (consumers.length > 0) {
    throw new Error(`cannot remove ${dependency}; staged consumers remain:\n${consumers.join('\n')}`)
  }
  rmSync(hoisted, { recursive: true, force: true })
}

function assertDeprecatedLockBranchesAreNotShipped() {
  const store = join(runtime, 'node_modules', '.pnpm')
  const forbidden = [
    ['glob', '10.5.0'],
    ['glob', '11.1.0'],
    ['node-domexception', '1.0.0'],
    ['tsconfck', '3.1.6'],
  ]
  const identities = new Set(forbidden.map(([name, version]) => `${name}@${version}`))
  const shipped = new Set((existsSync(store)
    ? readdirSync(store, { withFileTypes: true })
    : [])
    .filter(entry => entry.isDirectory() && identities.has(entry.name))
    .map(entry => entry.name))
  for (const [name, version] of forbidden) {
    const manifestPath = join(runtimePackageDirectory(name), 'package.json')
    if (!existsSync(manifestPath)) continue
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest.name === name && manifest.version === version) shipped.add(`${name}@${version}`)
  }
  if (shipped.size > 0) {
    throw new Error(`deprecated dependencies remain in the staged runtime: ${[...shipped].join(', ')}`)
  }
  console.log('Dependency audit: deprecated packages from the shared lock are not shipped')
}

/**
 * Make the staged tree portable: re-create absolute internal links as
 * relative ones and dereference any link still pointing outside the runtime
 * (Windows junctions the `.pnpm` entries to the global store). Dangling
 * links were already repaired against the source checkout above.
 */
function rewriteWorkspaceLinks() {
  const links = []
  walk(runtime, path => { links.push(path) })
  for (const link of links) {
    const raw = readlinkSync(link)
    const logicalTarget = resolve(dirname(link), raw)
    if (logicalTarget === runtime || logicalTarget.startsWith(runtime + sep)) {
      const canonical = relative(dirname(link), logicalTarget)
      if (raw !== canonical || isWindowsNode) portableSymlink(canonical, link)
      continue
    }
    if (logicalTarget === dshSource || logicalTarget.startsWith(dshSource + sep)) {
      const stagedTarget = stageWorkspaceTarget(logicalTarget)
      portableSymlink(relative(dirname(link), stagedTarget), link)
      continue
    }
    const stagedTarget = stageSourceCounterpart(link)
    if (stagedTarget !== undefined) {
      portableSymlink(relative(dirname(link), stagedTarget), link)
    }
  }
}

function relinkInstallationWorkspacePackages() {
  for (const [packageName, source] of discoverSourcePackages()) {
    if (source === dshSource) continue
    const link = join(runtime, 'node_modules', ...packageName.split('/'))
    const stat = existsSync(link) ? lstatSync(link) : undefined
    if (stat !== undefined && !stat.isSymbolicLink()) continue
    if (stat === undefined && findDeployedPackage(source) === undefined) continue
    const stagedTarget = stageWorkspaceTarget(source)
    mkdirSync(dirname(link), { recursive: true })
    portableSymlink(relative(dirname(link), stagedTarget), link)
  }
}

function assertSelfContained(rootPath, label) {
  const failures = []
  walk(rootPath, link => {
    const target = resolve(dirname(link), readlinkSync(link))
    if (!existsSync(target)) {
      failures.push(`${link} -> ${readlinkSync(link)} (dangling)`)
      return
    }
    if (target !== rootPath && !target.startsWith(rootPath + sep)) {
      failures.push(`${link} -> ${readlinkSync(link)} (outside stage)`)
    }
  })
  if (failures.length > 0) {
    throw new Error(`${label} contains non-portable symlinks:\n${failures.slice(0, 40).join('\n')}`)
  }
}

function runtimePackageDirectory(name) {
  return join(runtime, 'node_modules', ...name.split('/'))
}

function resolveDependencyManifest(requireFromPackage, dependency, fromManifestPath) {
  try {
    return requireFromPackage.resolve(`${dependency}/package.json`)
  } catch (packageJsonError) {
    // The exports map may declare a "require" entry pointing at a file the
    // package does not ship while the "import" entry exists (e.g.
    // @upsetjs/venn.js@2.0.0: require -> ./build/index.js, import ->
    // ./build/venn.esm.js). The bundled runtime consumes these packages
    // through import semantics, so resolve the entry with import semantics
    // based on the requiring package's manifest.
    try {
      const resolvedUrl = import.meta.resolve(dependency, pathToFileURL(fromManifestPath).href)
      const manifestPath = manifestUpwardFrom(dirname(fileURLToPath(resolvedUrl)), dependency)
      if (manifestPath !== null) return manifestPath
    } catch { /* fall through */ }
    // The physical node_modules chain (require-style walk that ignores
    // exports entirely) — stage only needs the package's files. The
    // manifest is returned REALPATHED: createRequire resolves sibling
    // dependencies from the manifest's directory, and a symlinked
    // workspace path would miss the .pnpm isolation dir's siblings.
    const directory = locatePackageDirectory(fromManifestPath, dependency)
    if (directory !== null) return realpathSync(join(directory, 'package.json'))
    let walk = dirname(requireFromPackage.resolve(dependency))
    for (;;) {
      const manifestPath = join(walk, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (manifest.name === dependency) return manifestPath
      }
      const parent = dirname(walk)
      if (parent === walk) throw packageJsonError
      walk = parent
    }
  }
}

/** Walk upward from a resolved entry file to the nearest matching manifest. */
function manifestUpwardFrom(directory, dependency) {
  for (;;) {
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (manifest.name === dependency) return manifestPath
    }
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

/** Physical node_modules-chain lookup (exports-agnostic). */
function locatePackageDirectory(fromManifestPath, dependency) {
  let directory = dirname(fromManifestPath)
  for (;;) {
    const candidate = join(directory, 'node_modules', ...dependency.split('/'))
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

function packageMatches(directory, expected) {
  const manifestPath = join(directory, 'package.json')
  if (!existsSync(manifestPath)) return false
  const actual = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return actual.name === expected.name && actual.version === expected.version
}

function installCompiledPackageDependencies(sourceManifestPath, packageDir) {
  const runtimeNodeModules = join(runtime, 'node_modules')
  const installed = new Map()

  const installManifest = manifestPath => {
    const canonicalManifest = realpathSync(manifestPath)
    const existing = installed.get(canonicalManifest)
    if (existing !== undefined) return existing
    const source = dirname(canonicalManifest)
    const manifest = JSON.parse(readFileSync(canonicalManifest, 'utf8'))
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`invalid runtime dependency manifest: ${canonicalManifest}`)
    }
    const shared = join(runtimeNodeModules, ...manifest.name.split('/'))
    if (existsSync(join(shared, 'package.json'))) {
      installed.set(canonicalManifest, shared)
      return shared
    }
    const target = shared
    installed.set(canonicalManifest, target)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, {
      dereference: true,
      preserveTimestamps: true,
      recursive: true,
      filter: candidate => {
        const rel = relative(source, candidate)
        return rel === '' || rel.split(sep)[0] !== 'node_modules'
      },
    })

    const requireFromPackage = createRequire(canonicalManifest)
    for (const [dependency, optional] of dependencyNames(manifest)) {
      try {
        installManifest(
          resolveDependencyManifest(requireFromPackage, dependency, canonicalManifest),
        )
      } catch (error) {
        if (optional) continue
        throw new Error(`${manifest.name} is missing runtime dependency ${dependency}`, { cause: error })
      }
    }
    return target
  }

  const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'))
  const requireFromSource = createRequire(sourceManifestPath)
  for (const [dependency, optional] of dependencyNames(sourceManifest)) {
    try {
      installManifest(
        resolveDependencyManifest(requireFromSource, dependency, sourceManifestPath),
      )
    } catch (error) {
      if (optional) continue
      throw new Error(`${sourceManifest.name} is missing runtime dependency ${dependency}`, { cause: error })
    }
  }
}

function runtimeDependencyTarget(dependency) {
  const candidate = join(runtime, 'node_modules', ...dependency.split('/'))
  if (existsSync(join(candidate, 'package.json'))) return candidate
  throw new Error(`DSH runtime is missing host dependency ${dependency}`)
}

function installCompiledPackageHostDependencies(sourceManifestPath, packageDir) {
  const manifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'))
  for (const dependency of manifest.dshStudio?.hostDependencies ?? []) {
    const candidate = runtimePackageDirectory(dependency)
    if (!existsSync(join(candidate, 'package.json'))) {
      throw new Error(`${manifest.name} cannot resolve staged DSH peer ${dependency}`)
    }
  }
}

function installDesktopPackages() {
  const packages = [
    {
      manifest: join(root, 'package.json'),
      files: [
        [join(root, 'dist', 'plugin.js'), 'dist/plugin.js'],
        [join(root, 'dist', 'client.js'), 'dist/client.js'],
        [join(root, 'dist', 'client.js.map'), 'dist/client.js.map'],
        [join(root, 'dist', 'cordis.patch.yml'), 'dist/cordis.patch.yml'],
      ],
    },
    {
      manifest: join(root, 'plugins', 'sidebar-host', 'package.json'),
      files: [
        [
          join(root, 'dist', 'plugins', 'sidebar-host', 'index.js'),
          'dist/index.js',
        ],
        [
          join(root, 'dist', 'plugins', 'sidebar-host', 'client-mermaid.js'),
          'dist/client-mermaid.js',
        ],
        [
          join(root, 'dist', 'plugins', 'sidebar-host', 'client-mermaid.js.map'),
          'dist/client-mermaid.js.map',
        ],
        [
          join(root, 'dist', 'plugins', 'sidebar-host', 'client-pierre-worker.js'),
          'dist/client-pierre-worker.js',
        ],
        [
          join(root, 'dist', 'plugins', 'sidebar-host', 'client-pierre-worker.js.map'),
          'dist/client-pierre-worker.js.map',
        ],
      ],
    },
    ...[
      'desktop-skins',
      'sidebar',
      'sidebar-desktop',
      'desktop-left-rail',
      'panel-controls',
      'pinned-summary',
      'plugin-marketplace',
    ].map(directory => ({
      manifest: join(root, 'plugins', directory, 'package.json'),
      files: [
        [join(root, 'dist', 'plugins', directory, 'index.js'), 'dist/index.js'],
        [join(root, 'dist', 'plugins', directory, 'client.js'), 'dist/client.js'],
        [join(root, 'dist', 'plugins', directory, 'client.js.map'), 'dist/client.js.map'],
      ],
    })),
    {
      manifest: join(root, 'web', 'package.json'),
      files: [
        [join(root, 'dist', 'web', 'index.js'), 'dist/index.js'],
        [join(root, 'dist', 'web', 'client.js'), 'dist/client.js'],
        [join(root, 'dist', 'web', 'client.js.map'), 'dist/client.js.map'],
        [join(root, 'dist', 'web', 'cordis.patch.yml'), 'dist/cordis.patch.yml'],
      ],
    },
  ]
  const installedVersions = {}
  for (const spec of packages) {
    const manifest = JSON.parse(readFileSync(spec.manifest, 'utf8'))
    delete manifest.build
    delete manifest.devDependencies
    delete manifest.scripts
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`invalid bundled plugin manifest: ${spec.manifest}`)
    }
    const packageDir = runtimePackageDirectory(manifest.name)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify(manifest, undefined, 2) + '\n')
    installCompiledPackageDependencies(spec.manifest, packageDir)
    installCompiledPackageHostDependencies(spec.manifest, packageDir)
    for (const [source, target] of spec.files) {
      const output = join(packageDir, target)
      mkdirSync(dirname(output), { recursive: true })
      if (lstatSync(source).isDirectory()) {
        cpSync(source, output, {
          dereference: true,
          preserveTimestamps: true,
          recursive: true,
        })
      } else {
        copyFileSync(source, output)
      }
    }
    if (manifest.name === 'dsh-cc-tui') adaptTuiRendererPackage(packageDir)
    installedVersions[manifest.name] = manifest.version
  }
  const cliManifestPath = join(runtime, 'package.json')
  const cliManifest = JSON.parse(readFileSync(cliManifestPath, 'utf8'))
  cliManifest.dependencies = {
    ...cliManifest.dependencies,
    ...installedVersions,
  }
  writeFileSync(cliManifestPath, JSON.stringify(cliManifest, undefined, 2) + '\n')
}

function restoreExecutableHelpers() {
  if (process.platform === 'win32') return
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name === 'spawn-helper' && !entry.isSymbolicLink()) chmodSync(path, 0o755)
    }
  }
  visit(runtime)
}

/**
 * node-pty publishes darwin/win32 prebuilds but no Linux ones, and the
 * `pnpm deploy` step reinstalls packages from the store, which drops the
 * `build/` output produced during `pnpm install`. Rebuild the native module
 * inside the staged runtime against the staged Node so the PTY host works on
 * Linux; macOS keeps using its published prebuild.
 */
function ensureLinuxPtyBuild() {
  if (process.platform !== 'linux') return
  const storeRoot = join(runtime, 'node_modules', '.pnpm')
  const hoistedDir = join(runtime, 'node_modules', 'node-pty')
  const packageDir = existsSync(hoistedDir)
    ? hoistedDir
    : (() => {
        const ptyEntry = readdirSync(storeRoot, { withFileTypes: true })
          .find(entry => entry.isDirectory() && entry.name.startsWith('node-pty@'))
        if (ptyEntry === undefined) return undefined
        return join(storeRoot, ptyEntry.name, 'node_modules', 'node-pty')
      })()
  if (packageDir === undefined) return
  const prebuild = join(packageDir, 'prebuilds', `linux-${nodeArch}`)
  if (existsSync(join(packageDir, 'build', 'Release', 'pty.node')) || existsSync(join(prebuild, 'pty.node'))) return
  const hoistedAddon = join(runtime, 'node_modules', 'node-addon-api')
  const addonTarget = existsSync(hoistedAddon)
    ? hoistedAddon
    : (() => {
        const addonEntry = readdirSync(storeRoot, { withFileTypes: true })
          .find(entry => entry.isDirectory() && entry.name.startsWith('node-addon-api@'))
        if (addonEntry === undefined) {
          throw new Error('staged runtime is missing node-addon-api; cannot compile node-pty')
        }
        return join(storeRoot, addonEntry.name, 'node_modules', 'node-addon-api')
      })()
  const dependencyDir = join(packageDir, 'node_modules')
  mkdirSync(dependencyDir, { recursive: true })
  const addonLink = join(dependencyDir, 'node-addon-api')
  rmSync(addonLink, { recursive: true, force: true })
  symlinkSync(relative(dependencyDir, addonTarget), addonLink)
  const nodeGyp = join(nodeRuntime, 'lib', 'node_modules', 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
  if (!existsSync(nodeGyp)) {
    throw new Error('staged Node runtime is missing node-gyp; cannot compile node-pty')
  }
  try {
    run(join(nodeRuntime, 'bin', 'node'), [nodeGyp, 'rebuild'], { cwd: packageDir, env: process.env })
  } finally {
    rmSync(addonLink, { force: true })
    rmSync(dependencyDir, { recursive: true, force: true })
  }
  if (!existsSync(join(packageDir, 'build', 'Release', 'pty.node'))) {
    throw new Error('node-pty build did not produce build/Release/pty.node')
  }
}

/**
 * Strip foreign-platform native artifacts the pnpm deploy copies verbatim:
 *
 * - Windows PDB debug symbols (~36 MB per node-pty copy) — debug data is
 *   never loaded at runtime, on any platform.
 * - prebuilds for platforms other than the packaging target (~45 MB per
 *   node-pty copy). node-pty is the only prebuild-shipping dependency in
 *   the closure (sharp deploys per-platform already). Linux keeps its
 *   prebuild dirs — ensureLinuxPtyBuild rebuilds into them when missing —
 *   and `arch` mismatches (e.g. darwin-x64 on an arm64 build) are also
 *   dropped, matching the runtime's own per-platform deploy.
 */
function sweepForeignNativeArtifacts() {
  const platformPrefix = { darwin: 'darwin', linux: 'linux', win32: 'win32' }[nodePlatform]
  if (platformPrefix === undefined) return
  let removedPdb = 0
  let removedPrebuildDirs = 0
  const pdbDirs = []
  const visitDirectory = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.pnpm-store' || entry.name === '.cache') continue
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (!entry.isDirectory()) continue
      if (entry.name === 'prebuilds') { pdbDirs.push(path); continue }
      visitDirectory(path)
    }
  }
  visitDirectory(runtime)
  for (const prebuilds of pdbDirs) {
    for (const entry of readdirSync(prebuilds, { withFileTypes: true })) {
      if (entry.name.startsWith(platformPrefix)) continue
      rmSync(join(prebuilds, entry.name), { recursive: true, force: true })
      removedPrebuildDirs += 1
    }
    for (const file of readdirSync(prebuilds)) {
      if (file.endsWith('.pdb')) {
        rmSync(join(prebuilds, file), { force: true })
        removedPdb += 1
      }
    }
  }
  if (removedPdb > 0 || removedPrebuildDirs > 0) {
    console.log(
      `Swept foreign native artifacts: ${String(removedPdb)} PDB files, `
      + `${String(removedPrebuildDirs)} foreign prebuild directories`,
    )
  }
}

if (!npmRelease && !existsSync(join(dshSource, 'apps', 'cli', 'package.json'))) {
  throw new Error(`DSH source checkout not found: ${dshSource}`)
}
for (const required of [
  'plugin.js',
  'client.js',
  'client.js.map',
  'cordis.patch.yml',
  'web/index.js',
  'web/client.js',
  'web/client.js.map',
  'web/cordis.patch.yml',
  'plugins/sidebar-host/index.js',
  'plugins/desktop-skins/index.js',
  'plugins/desktop-skins/client.js',
  'plugins/sidebar/index.js',
  'plugins/sidebar/client.js',
  'plugins/sidebar-desktop/index.js',
  'plugins/sidebar-desktop/client.js',
  'plugins/desktop-left-rail/index.js',
  'plugins/desktop-left-rail/client.js',
  'plugins/panel-controls/index.js',
  'plugins/panel-controls/client.js',
  'plugins/pinned-summary/index.js',
  'plugins/pinned-summary/client.js',
  'plugins/plugin-marketplace/index.js',
  'plugins/plugin-marketplace/client.js',
]) {
  if (!existsSync(join(root, 'dist', required))) {
    throw new Error(`desktop artifact missing: dist/${required}; run pnpm run build first`)
  }
}

const pnpm = resolvePinnedPnpm(dshSource)
const fingerprintPath = join(stage, '.stage-fingerprint.json')

/**
 * Fingerprint of everything the dependency layout depends on: the pinned
 * source spec, lockfiles and manifests, the Node distribution target, the
 * pnpm entry, and the staging/pruning scripts themselves. When the recorded
 * fingerprint matches, the previous stage's dependency layout (deploy +
 * patches + baked assets + node runtime) is reused as-is; only content
 * assembly and every validation gate still run. Any of these inputs
 * changing re-runs the expensive layout build.
 */
function dependencyFingerprint() {
  const lockfile = npmRelease
    ? join(root, 'scripts', `dsh-runtime-${DSH_SOURCE_SPEC.version}-lock.yaml`)
    : join(dshSource, 'pnpm-lock.yaml')
  const stagedScripts = [
    'stage-dsh.mjs',
    'prune-stage.mjs',
    'runtime-contract.mjs',
    'dsh-source.mjs',
    'dsh-runtime-patches.mjs',
    'verify-staged-layout.mjs',
    'runtime-closure-probe.mjs',
    ...(npmRelease ? [] : ['bake-skin-palette.mjs']),
  ].map(name => fileHash(join(root, 'scripts', name)))
  const inputs = [
    fileHash(join(root, 'dsh-source.json')),
    fileHash(join(root, 'package.json')),
    fileHash(join(dshSource, 'package.json')),
    fileHash(lockfile),
    nodeVersion,
    nodePlatform,
    nodeArch,
    pnpm.cliEntry,
    ...stagedScripts,
  ]
  return createHash('sha256').update(inputs.join('\n')).digest('hex')
}

function fileHash(path) {
  return existsSync(path) ? sha256(path) : 'missing'
}

const fingerprint = dependencyFingerprint()
const nodeEntry = join(nodeRuntime, isWindowsNode ? 'node.exe' : join('bin', 'node'))
const reuseLayout = existsSync(fingerprintPath)
  && readFileSync(fingerprintPath, 'utf8').trim() === fingerprint
  && existsSync(join(runtime, 'node_modules'))
  && existsSync(nodeEntry)

if (reuseLayout) {
  console.log('Dependency fingerprint unchanged; reusing staged runtime layout')
} else {
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  if (npmRelease) {
    const releaseLockfile = join(root, 'scripts', `dsh-runtime-${DSH_SOURCE_SPEC.version}-lock.yaml`)
    const assemblyLockfile = join(dshSource, 'pnpm-lock.yaml')
    if (!existsSync(releaseLockfile)) {
      throw new Error(`missing pinned DSH runtime lockfile: ${releaseLockfile}`)
    }
    copyFileSync(releaseLockfile, assemblyLockfile)
    console.log(`Installing pinned DSH npm release ${DSH_SOURCE_SPEC.version}`)
    run(process.execPath, [pnpm.cliEntry, '--reporter=silent', '--ignore-scripts', 'install', '--frozen-lockfile'], {
      cwd: dshSource,
      env: { ...process.env, PATH: `${pnpm.binDir}${delimiter}${process.env.PATH ?? ''}` },
    })
  }
  // Deploy a flat runtime: node-linker=hoisted materializes every package as a
  // real directory (inject-workspace-packages copies workspace packages in
  // place), so the staged tree has no .pnpm virtual store and no symlinks. The
  // pruner and the pack tooling then walk plain directories, and the packaged
  // app carries no junction/link surprises on any platform.
  console.log(`Deploying pinned DSH runtime (${npmRelease ? 'npm assembly' : 'source'} hoisted mode)`)
  run(process.execPath, [
    pnpm.cliEntry,
    '--reporter=silent',
    '--config.package-import-method=copy',
    '--config.node-linker=hoisted',
    '--config.inject-workspace-packages=true',
    '--ignore-scripts',
    '--filter', '@deepseek-ai/dsh',
    'deploy', '--prod', runtime,
  ], {
    cwd: dshSource,
    env: { ...process.env, PATH: `${pnpm.binDir}${delimiter}${process.env.PATH ?? ''}` },
  })

  replaceDeprecatedDomExceptionShim()
  if (npmRelease) {
    console.log('Recording npm release dependency graph')
    recordExposedDependencies()
  } else {
    if (isWindowsNode) ensureWindowsWorkspacePackages()
    console.log('Relinking workspace packages')
    rewriteWorkspaceLinks()
    relinkInstallationWorkspacePackages()
  }
  console.log('Applying DSH runtime patches')
  applyDshRuntimePatches(runtime, root)
  {
    let assets = npmRelease
      ? join(runtimeDependencyTarget('@deepseek-ai/dsh-web-frontend'), 'dist', 'assets')
      : join(runtime, 'workspace', 'apps', 'web', 'dist', 'assets')
    if (!existsSync(assets) && !npmRelease) {
      const sourceDist = join(dshSource, 'apps', 'web', 'dist')
      const targetDist = join(runtime, 'workspace', 'apps', 'web', 'dist')
      if (existsSync(join(sourceDist, 'assets'))) {
        mkdirSync(join(runtime, 'workspace', 'apps', 'web'), { recursive: true })
        cpSync(sourceDist, targetDist, { recursive: true, preserveTimestamps: true })
        assets = join(targetDist, 'assets')
        console.log('Copied web shell dist from DSH source (deploy gap fill)')
      }
    }
    if (!existsSync(assets)) {
      throw new Error(`staged web shell assets missing at ${assets}; cannot bake skin palette`)
    }
    bakeSkinPalette(assets)
    console.log('Baked ChatGPT default palette into staged web shell css')
  }
  ensureNodeRuntime()
  ensureLinuxPtyBuild()
}

assertDeprecatedLockBranchesAreNotShipped()
console.log('Verifying staged DSH layout interactions')
verifyStagedLayout(runtime)
console.log('Installing desktop packages')
installDesktopPackages()
sweepForeignNativeArtifacts()
copyFileSync(join(npmRelease ? root : dshSource, 'THIRD_PARTY_NOTICES.md'), join(runtime, 'THIRD_PARTY_NOTICES.md'))
restoreExecutableHelpers()
assertSelfContained(runtime, 'DSH runtime')
assertSelfContained(nodeRuntime, 'Node runtime')

// Prune runtime-unreachable payload before the packaged artifacts consume
// the stage: declaration files, dev-only directories, unreferenced src
// trees, unreachable build variants, orphaned dependency-store entries,
// and the Node distribution's compile-time payload. Source maps are
// intentionally kept.
const pruneStats = {
  ...pruneRuntimeDependencies(runtime),
  nodeDietBytes: dietNodeRuntime(nodeRuntime).nodeDietBytes,
}
console.log(summarize(pruneStats))
assertSelfContained(runtime, 'DSH runtime')
assertSelfContained(nodeRuntime, 'Node runtime')

// Size gate: the staged runtime may only grow inside the contract budget.
// The packaged-app gate runs again after packaging (verify in build-*.mjs).
const budgetPlatform = { darwin: 'darwin', linux: 'linux', win: 'win32' }[nodePlatform]
if (budgetPlatform !== undefined) {
  const gate = assertRuntimeBudget(runtime, budgetPlatform, runtimeContract)
  console.log(
    `Runtime budget: ${(gate.bytes / 1048576).toFixed(1)} MiB / ${String(gate.files)} files `
    + `(limit ${(runtimeContract.runtime.sizeBudgetBytes[budgetPlatform] / 1048576).toFixed(1)} MiB / `
    + `${String(runtimeContract.runtime.fileBudget)} files)`,
  )
}

const stagedNode = join(nodeRuntime, isWindowsNode ? 'node.exe' : join('bin', 'node'))
const hostPlatform = { darwin: 'darwin', linux: 'linux', win: 'win32' }[nodePlatform]
if (hostPlatform === process.platform) {
  run(stagedNode, [join(runtime, 'lib', 'bin.js'), '--version'], {
    cwd: runtime,
    env: { ...process.env, DSH_HOME: join(stage, 'smoke-home') },
  })
  // The pruner removes payload the resolver cannot reach; this probe imports
  // the heavyweight closure from the pruned tree so a wrong reachability
  // call fails staging instead of shipping a broken app.
  run(stagedNode, [join(root, 'scripts', 'runtime-closure-probe.mjs'), runtime], {
    cwd: runtime,
    env: { ...process.env, DSH_HOME: join(stage, 'smoke-home') },
  })
  if (isWindowsNode) {
    run(stagedNode, [join(nodeRuntime, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'), '--version'], {
      cwd: runtime,
      env: process.env,
    })
  } else {
    run(join(nodeRuntime, 'bin', 'pnpm'), ['--version'], { cwd: runtime, env: process.env })
  }
} else {
  console.log(`Skipping staged runtime launch checks: ${nodePlatform} binaries cannot run on ${process.platform}`)
}

// A completed stage is the only valid baseline for the fast path: the
// fingerprint is recorded after every gate passed, so an interrupted or
// failed stage never marks its layout reusable.
writeFileSync(fingerprintPath, `${fingerprint}\n`)
console.log(`Staged DSH runtime: ${runtime}`)
console.log(`Staged Node ${nodeVersion}: ${nodeRuntime}`)

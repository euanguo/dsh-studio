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
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshSource } from './dsh-source.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dshSource = resolveDshSource()
const stage = join(root, '.stage')
const runtime = join(stage, 'dsh-runtime')
const nodeRuntime = join(stage, 'node-runtime')
const cache = join(root, '.cache')
const nodeVersion = process.env.DSH_DESKTOP_NODE_VERSION ?? '26.0.0'
const nodeFolder = `node-v${nodeVersion}-darwin-arm64`
const nodeArchiveName = `${nodeFolder}.tar.gz`
const nodeArchive = join(cache, nodeArchiveName)
const nodeCache = join(cache, nodeFolder)

if (!existsSync(join(dshSource, 'apps', 'web', 'dist', 'index.html'))
  || !existsSync(join(dshSource, 'apps', 'cli', 'lib', 'bin.js'))) {
  throw new Error(`DSH build artifacts are missing at ${dshSource}; run pnpm run build:dsh first`)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${String(result.status)}`)
  }
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

function ensureNodeRuntime() {
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
  if (!existsSync(join(nodeCache, 'bin', 'node'))) {
    const extraction = join(cache, `.node-extract-${String(process.pid)}`)
    rmSync(extraction, { recursive: true, force: true })
    mkdirSync(extraction, { recursive: true })
    run('tar', ['-xzf', nodeArchive, '-C', extraction])
    rmSync(nodeCache, { recursive: true, force: true })
    cpSync(join(extraction, nodeFolder), nodeCache, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    })
    rmSync(extraction, { recursive: true, force: true })
  }
  for (const [name, target] of [
    ['npm', '../lib/node_modules/npm/bin/npm-cli.js'],
    ['npx', '../lib/node_modules/npm/bin/npx-cli.js'],
  ]) {
    const launcher = join(nodeCache, 'bin', name)
    rmSync(launcher, { force: true })
    symlinkSync(target, launcher)
  }
  rmSync(nodeRuntime, { recursive: true, force: true })
  cpSync(nodeCache, nodeRuntime, {
    recursive: true,
    preserveTimestamps: true,
    verbatimSymlinks: true,
  })
  chmodSync(join(nodeRuntime, 'bin', 'node'), 0o755)

  const pnpmSource = join(root, 'node_modules', 'pnpm')
  if (!existsSync(join(pnpmSource, 'dist', 'pnpm.mjs'))) {
    throw new Error('pnpm package is missing; run pnpm install before staging')
  }
  const pnpmTarget = join(nodeRuntime, 'lib', 'node_modules', 'pnpm')
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
  const pnpmBinary = join(nodeRuntime, 'bin', 'pnpm')
  rmSync(pnpmBinary, { force: true })
  symlinkSync('../lib/node_modules/pnpm/bin/pnpm.mjs', pnpmBinary)
  chmodSync(join(pnpmTarget, 'bin', 'pnpm.mjs'), 0o755)
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

const copiedTargets = new Map()
const deployedPackageTargets = new Map()
let sourcePackages

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

function findDeployedPackage(sourceTarget) {
  const manifestPath = join(sourceTarget, 'package.json')
  if (!existsSync(manifestPath)) return undefined
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return undefined
  const key = `${manifest.name}@${manifest.version}`
  if (deployedPackageTargets.has(key)) return deployedPackageTargets.get(key)
  const store = join(runtime, 'node_modules', '.pnpm')
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
    rmSync(targetLink, { recursive: true, force: true })
    symlinkSync(relative(dirname(targetLink), target), targetLink)
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

function walk(rootPath, visit) {
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const path = join(rootPath, entry.name)
    if (entry.isSymbolicLink()) visit(path)
    else if (entry.isDirectory()) walk(path, visit)
  }
}

function rewriteWorkspaceLinks() {
  const links = []
  walk(runtime, path => { links.push(path) })
  for (const link of links) {
    const raw = readlinkSync(link)
    const logicalTarget = resolve(dirname(link), raw)
    if (logicalTarget !== dshSource && !logicalTarget.startsWith(dshSource + sep)) continue
    const stagedTarget = stageWorkspaceTarget(logicalTarget)
    rmSync(link)
    symlinkSync(relative(dirname(link), stagedTarget), link)
  }
}

function relinkInstallationWorkspacePackages() {
  for (const [packageName, source] of discoverSourcePackages()) {
    const link = join(runtime, 'node_modules', ...packageName.split('/'))
    if (!existsSync(link)) continue
    const stagedTarget = stageWorkspaceTarget(source)
    rmSync(link, { recursive: true, force: true })
    symlinkSync(relative(dirname(link), stagedTarget), link)
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

function resolveDependencyManifest(requireFromPackage, dependency) {
  try {
    return requireFromPackage.resolve(`${dependency}/package.json`)
  } catch (packageJsonError) {
    let directory = dirname(requireFromPackage.resolve(dependency))
    for (;;) {
      const manifestPath = join(directory, 'package.json')
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (manifest.name === dependency) return manifestPath
      }
      const parent = dirname(directory)
      if (parent === directory) throw packageJsonError
      directory = parent
    }
  }
}

function installCompiledPackageDependencies(sourceManifestPath, packageDir) {
  const installRoot = join(packageDir, 'node_modules')
  const installed = new Set()

  const installManifest = manifestPath => {
    const source = dirname(manifestPath)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
      throw new Error(`invalid runtime dependency manifest: ${manifestPath}`)
    }
    const key = `${manifest.name}@${manifest.version}`
    if (installed.has(key)) return
    installed.add(key)
    const target = join(installRoot, ...manifest.name.split('/'))
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

    const requireFromPackage = createRequire(manifestPath)
    for (const [dependency, optional] of dependencyNames(manifest)) {
      try {
        installManifest(resolveDependencyManifest(requireFromPackage, dependency))
      } catch (error) {
        if (optional) continue
        throw new Error(`${manifest.name} is missing runtime dependency ${dependency}`, { cause: error })
      }
    }
  }

  const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'))
  const requireFromSource = createRequire(sourceManifestPath)
  for (const dependency of Object.keys(sourceManifest.dependencies ?? {})) {
    installManifest(resolveDependencyManifest(requireFromSource, dependency))
  }
}

function installCompiledPackageHostDependencies(sourceManifestPath, packageDir) {
  const manifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'))
  const sourcePackages = discoverSourcePackages()
  for (const dependency of manifest.ohDsh?.hostDependencies ?? []) {
    const source = sourcePackages.get(dependency)
    if (source === undefined) {
      throw new Error(`${manifest.name} cannot resolve DSH peer ${dependency}`)
    }
    const target = stageWorkspaceTarget(source)
    const link = join(packageDir, 'node_modules', ...dependency.split('/'))
    mkdirSync(dirname(link), { recursive: true })
    rmSync(link, { recursive: true, force: true })
    symlinkSync(relative(dirname(link), target), link)
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
      manifest: join(root, 'plugins', 'better-sidebar-runtime', 'package.json'),
      files: [
        [
          join(root, 'dist', 'plugins', 'better-sidebar-runtime', 'index.js'),
          'dist/index.js',
        ],
      ],
    },
    ...[
      'desktop-skins',
      'desktop-sidebar',
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
      copyFileSync(source, output)
    }
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
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.name === 'spawn-helper' && !entry.isSymbolicLink()) chmodSync(path, 0o755)
    }
  }
  visit(runtime)
}

if (!existsSync(join(dshSource, 'apps', 'cli', 'package.json'))) {
  throw new Error(`DSH source checkout not found: ${dshSource}`)
}
for (const required of [
  'plugin.js',
  'client.js',
  'client.js.map',
  'cordis.patch.yml',
  'plugins/better-sidebar-runtime/index.js',
  'plugins/desktop-skins/index.js',
  'plugins/desktop-skins/client.js',
  'plugins/desktop-sidebar/index.js',
  'plugins/desktop-sidebar/client.js',
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

rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
run('corepack', ['pnpm',
  '--ignore-scripts',
  '--filter', '@deepseek-ai/dsh',
  'deploy', '--prod', '--legacy', runtime,
], { cwd: dshSource, env: process.env })

rewriteWorkspaceLinks()
relinkInstallationWorkspacePackages()
installDesktopPackages()
copyFileSync(join(dshSource, 'THIRD_PARTY_NOTICES.md'), join(runtime, 'THIRD_PARTY_NOTICES.md'))
restoreExecutableHelpers()
assertSelfContained(runtime, 'DSH runtime')
ensureNodeRuntime()
assertSelfContained(nodeRuntime, 'Node runtime')

run(join(nodeRuntime, 'bin', 'node'), [join(runtime, 'lib', 'bin.js'), '--version'], {
  cwd: runtime,
  env: { ...process.env, DSH_HOME: join(stage, 'smoke-home') },
})
run(join(nodeRuntime, 'bin', 'pnpm'), ['--version'], { cwd: runtime, env: process.env })

console.log(`Staged DSH runtime: ${runtime}`)
console.log(`Staged Node ${nodeVersion}: ${nodeRuntime}`)

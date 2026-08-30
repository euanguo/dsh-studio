import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_SOURCE_SPEC, resolveDshSource, resolvePinnedPnpm } from './dsh-source.mjs'
import {
  FACTS_PATH,
  deriveTsconfigPaths,
  readDependencyFacts,
  resolveConfiguredTypePaths,
} from './sync-dsh-dependencies.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dshSource = resolveDshSource()
const pnpm = resolvePinnedPnpm(dshSource)

// The npm release ships compiled host and web artifacts but no node_modules,
// and its runtime-only closure excludes the client packages the tsconfig maps.
// The package list and per-specifier declaration resolution come from the
// single dependency fact source (config/dsh-dependencies.json) through the
// shared rules in scripts/sync-dsh-dependencies.mjs — this script owns no
// duplicate scan. Install those packages at their exact pinned release
// version into a fixed type sandbox (.cache/dsh-source/npm-types), rewrite
// the tsconfig paths block into the sandbox, then exit 0. CI typecheck runs
// right after build:dsh and depends on this step.
if (DSH_SOURCE_SPEC.source === 'npm') {
  const facts = readDependencyFacts(root)
  const sandbox = join(root, '.cache', 'dsh-source', 'npm-types')
  mkdirSync(sandbox, { recursive: true })
  const devDependencies = Object.fromEntries([...new Set(
    Object.keys(facts.typePackages).map(specifier => specifier.split('/').slice(0, 2).join('/')),
  )].sort().map(name => [name, DSH_SOURCE_SPEC.version]))
  if (Object.keys(devDependencies).length === 0) {
    throw new Error(`${FACTS_PATH} declares no typePackages to type`)
  }
  writeFileSync(join(sandbox, 'package.json'),
    `${JSON.stringify({ name: 'dsh-source-types', private: true, devDependencies }, null, 2)}\n`)
  // Own workspace root so pnpm installs the sandbox alone instead of
  // walking up into the repository workspace.
  writeFileSync(join(sandbox, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  run(['--reporter=silent', '--ignore-scripts', 'install'], sandbox)

  // Resolve every configured specifier through the pinned release's own
  // exports.types via the shared resolver, then rewrite the tsconfig paths
  // block with the same seed derivation the generator and guard check.
  const { resolved, missing } = resolveConfiguredTypePaths(join(sandbox, 'node_modules'), facts)
  if (missing.length > 0) {
    throw new Error(`type sandbox is missing declaration files (${missing.length}):\n${missing.join('\n')}`)
  }
  const config = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'))
  config.compilerOptions.paths = deriveTsconfigPaths({ ...facts, typePackages: resolved })
  writeFileSync(join(root, 'tsconfig.json'), `${JSON.stringify(config, null, 2)}\n`)
  console.log(`Installed ${DSH_SOURCE_SPEC.version} client types and rewired tsconfig paths`)
  process.exit(0)
}

function pinInnerPnpm() {
  const binDir = join(dshSource, 'node_modules', '.bin')
  mkdirSync(binDir, { recursive: true })
  if (process.platform === 'win32') {
    writeFileSync(join(binDir, 'pnpm.cmd'),
      `@"${process.execPath}" "${pnpm.cliEntry}" %*\r\n`)
    return
  }
  const launcher = join(binDir, 'pnpm')
  writeFileSync(launcher,
    `#!/bin/sh\nexec "${process.execPath}" "${pnpm.cliEntry}" "$@"\n`)
  chmodSync(launcher, 0o755)
}

function run(args, cwd = dshSource) {
  const result = spawnSync(process.execPath, [pnpm.cliEntry, ...args], {
    cwd,
    env: { ...process.env, PATH: `${pnpm.binDir}${delimiter}${process.env.PATH ?? ''}` },
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${pnpm.cliEntry} ${args.join(' ')} failed with status ${String(result.status)}`)
  }
}

// NOTE: the former withVisionSettingsNamespace() wrapper patched the pinned
// API-proxy settings allowlist for the @dsh-studio/vision plugin. That plugin
// tree was removed by the desktop reconciliation (desktop-skins replaced
// the skins surface; vision had no successor), so the patch served a dead
// namespace while making the whole DSH build fail whenever upstream reflows
// that allowlist line. It is gone with the plugin.

run(['install', '--frozen-lockfile'])
pinInnerPnpm()
run(['run', 'build'])

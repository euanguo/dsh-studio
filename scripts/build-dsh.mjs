import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_SOURCE_SPEC, resolveDshSource, resolvePinnedPnpm } from './dsh-source.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dshSource = resolveDshSource()
const pnpm = resolvePinnedPnpm(dshSource)

// The npm release ships compiled host and web artifacts but no node_modules,
// and its runtime-only closure excludes the web-frontend client packages that
// the root tsconfig maps. Install those client packages at their exact pinned
// release version into a fixed type sandbox (.cache/dsh-source/npm-types),
// then rewrite the tsconfig paths to point at the sandbox. CI typecheck runs
// right after build:dsh and depends on this step.
if (DSH_SOURCE_SPEC.source === 'npm') {
  const sandbox = join(root, '.cache', 'dsh-source', 'npm-types')
  mkdirSync(sandbox, { recursive: true })
  const config = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'))
  const packages = new Set()
  for (const key of Object.keys(config.compilerOptions?.paths ?? {})) {
    if (key.startsWith('@deepseek-ai/')) packages.add(key.split('/').slice(0, 2).join('/'))
  }
  if (packages.size === 0) throw new Error('tsconfig declares no @deepseek-ai paths to type')
  const devDependencies = Object.fromEntries([...packages].sort().map(name => [name, DSH_SOURCE_SPEC.version]))
  writeFileSync(join(sandbox, 'package.json'),
    `${JSON.stringify({ name: 'dsh-source-types', private: true, devDependencies }, null, 2)}\n`)
  // Own workspace root so pnpm installs the sandbox alone instead of
  // walking up into the repository workspace.
  writeFileSync(join(sandbox, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  run(['--reporter=silent', '--ignore-scripts', 'install'], sandbox)

  // Rewrite tsconfig targets to the sandbox, resolving each through the
  // package's own exports.types (subpath or root) so every layout — client
  // lib/types/<sub>/index.d.ts, flat host lib/types/<sub>.d.ts, and the
  // shared lib/typert.remote-client.d.ts — resolves exactly as published.
  const missing = []
  for (const [key, targets] of Object.entries(config.compilerOptions.paths ?? {})) {
    if (!key.startsWith('@deepseek-ai/')) continue
    const packageName = key.split('/').slice(0, 2).join('/')
    const subpath = key.split('/').slice(2).join('/')
    const packageDir = join(sandbox, 'node_modules', packageName)
    let typesPath
    try {
      const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
      const exportEntry = subpath === '' ? manifest.exports?.['.'] : manifest.exports?.[`./${subpath}`]
      if (typeof exportEntry === 'string') typesPath = exportEntry
      else if (typeof exportEntry?.types === 'string') typesPath = exportEntry.types
    } catch { /* reported as missing below */ }
    if (typeof typesPath !== 'string') {
      missing.push(`${key} -> no types declaration in ${packageName} exports`)
      continue
    }
    const candidate = join(packageDir, typesPath)
    if (!existsSync(candidate)) {
      missing.push(`${key} -> ${typesPath} missing in ${packageName}`)
      continue
    }
    config.compilerOptions.paths[key] = [`.${candidate.slice(root.length)}`]
  }
  if (missing.length > 0) {
    throw new Error(`type sandbox is missing declaration files (${missing.length}):\n${missing.join('\n')}`)
  }
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

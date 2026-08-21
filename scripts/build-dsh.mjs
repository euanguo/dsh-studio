import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { DSH_SOURCE_SPEC, resolveDshSource, resolvePinnedPnpm } from './dsh-source.mjs'

const dshSource = resolveDshSource()

// The npm release already contains compiled host and web artifacts. Dependency
// installation is performed by stage:dsh from the pinned runtime lockfile.
if (DSH_SOURCE_SPEC.source === 'npm') {
  console.log(`Using prebuilt DSH npm release ${DSH_SOURCE_SPEC.version}; skipping source build`)
  process.exit(0)
}

const pnpm = resolvePinnedPnpm(dshSource)

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

function run(args) {
  const result = spawnSync(process.execPath, [pnpm.cliEntry, ...args], {
    cwd: dshSource,
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

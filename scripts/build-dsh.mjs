import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { resolveDshSource, resolvePinnedPnpm } from './dsh-source.mjs'

const dshSource = resolveDshSource()
const pnpm = resolvePinnedPnpm(dshSource)

/**
 * npm runs scripts with the project's node_modules/.bin ahead of PATH, and
 * the DSH build scripts call `pnpm` for nested workspace commands. Pin that
 * bin to the declared CLI so the inner calls never reach a host pnpm whose
 * version-switch verification rejects the pinned lockfile.
 */
function pinInnerPnpm() {
  const binDir = join(dshSource, 'node_modules', '.bin')
  mkdirSync(binDir, { recursive: true })
  if (process.platform === 'win32') {
    writeFileSync(join(binDir, 'pnpm.cmd'),
      `@"${process.execPath}" "${pnpm.cliEntry}" %*\r\n`)
  } else {
    const launcher = join(binDir, 'pnpm')
    writeFileSync(launcher,
      `#!/bin/sh\nexec "${process.execPath}" "${pnpm.cliEntry}" "$@"\n`)
    chmodSync(launcher, 0o755)
  }
}

function run(args) {
  const result = spawnSync(process.execPath, [
    pnpm.cliEntry,
    ...args,
  ], {
    cwd: dshSource,
    env: {
      ...process.env,
      PATH: `${pnpm.binDir}${delimiter}${process.env.PATH ?? ''}`,
    },
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(['install', '--frozen-lockfile'])
pinInnerPnpm()
run(['run', 'build'])

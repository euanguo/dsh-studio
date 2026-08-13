import { spawnSync } from 'node:child_process'
import { resolveDshSource, resolvePinnedPnpm } from './dsh-source.mjs'

const dshSource = resolveDshSource()
const pnpmCli = resolvePinnedPnpm(dshSource)

function run(args) {
  const result = spawnSync(process.execPath, [
    pnpmCli,
    ...args,
  ], {
    cwd: dshSource,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(['install', '--frozen-lockfile'])
run(['run', 'build'])

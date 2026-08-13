import { spawnSync } from 'node:child_process'
import { delimiter } from 'node:path'
import { resolveDshSource, resolvePinnedPnpm } from './dsh-source.mjs'

const dshSource = resolveDshSource()
const pnpm = resolvePinnedPnpm(dshSource)

function run(args) {
  const result = spawnSync(process.execPath, [
    pnpm.cliEntry,
    '--pm-on-fail=ignore',
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
run(['run', 'build'])

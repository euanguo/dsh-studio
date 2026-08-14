import { spawnSync } from 'node:child_process'
import { resolveDshSource } from './dsh-source.mjs'

const dshSource = resolveDshSource()

function run(args) {
  const result = spawnSync('corepack', ['pnpm', ...args], {
    cwd: dshSource,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(['install', '--frozen-lockfile'])
run(['run', 'build:lib'])
run(['--filter', '@deepseek-ai/dsh-web-frontend', 'run', 'build'])

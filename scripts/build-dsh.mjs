import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshSource } from './dsh-source.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dshSource = resolveDshSource()
const pnpmCli = join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs')

function run(args) {
  // The pinned source declares `packageManager`, which would make pnpm swap
  // to a native build not present in its frozen lockfile; the harness is
  // installed with this repo's pinned pnpm instead.
  const result = spawnSync(process.execPath, [
    pnpmCli,
    '--pm-on-fail=ignore',
    '--config.manage-package-manager-versions=false',
    ...args,
  ], {
    cwd: dshSource,
    env: {
      ...process.env,
      npm_config_manage_package_manager_versions: 'false',
      npm_config_pm_on_fail: 'ignore',
    },
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(['install', '--frozen-lockfile'])
run(['run', 'build'])

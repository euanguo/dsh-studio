import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronPackage = join(root, 'node_modules', 'electron')
const electronBinary = join(electronPackage, 'dist', 'electron')
if (!existsSync(electronBinary)) {
  const installResult = spawnSync(process.execPath, [join(electronPackage, 'install.js')], {
    cwd: root,
    stdio: 'inherit',
  })
  if (installResult.error !== undefined) throw installResult.error
  if (installResult.status !== 0) process.exit(installResult.status ?? 1)
}

const iconSet = join(root, 'assets', 'icons', '512x512.png')
if (!existsSync(iconSet)) {
  const iconResult = spawnSync('sh', [join(root, 'scripts', 'generate-icon-linux.sh')], {
    cwd: root,
    stdio: 'inherit',
  })
  if (iconResult.error !== undefined) throw iconResult.error
  if (iconResult.status !== 0) process.exit(iconResult.status ?? 1)
}

const builder = join(root, 'node_modules', '.bin', 'electron-builder')
const result = spawnSync(builder, ['--linux'], {
  cwd: root,
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  },
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

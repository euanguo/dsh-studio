import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProductVersion } from '../src/version.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = resolveProductVersion(root)
const requestedArch = process.argv[2]
const arch = requestedArch ?? { arm64: 'arm64', x64: 'x64' }[process.arch] ?? process.arch
if (arch !== 'arm64' && arch !== 'x64') {
  throw new Error(`unsupported macOS architecture: ${arch}`)
}
const electronPackage = join(root, 'node_modules', 'electron')
const electronBinary = join(electronPackage, 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
if (!existsSync(electronBinary)) {
  const installResult = spawnSync(process.execPath, [join(electronPackage, 'install.js')], {
    cwd: root,
    stdio: 'inherit',
  })
  if (installResult.error !== undefined) throw installResult.error
  if (installResult.status !== 0) process.exit(installResult.status ?? 1)
}

const icon = join(root, 'assets', 'DSH Studio.icns')
if (!existsSync(icon)) {
  const iconResult = spawnSync('sh', [join(root, 'scripts', 'generate-icon.sh')], {
    cwd: root,
    stdio: 'inherit',
  })
  if (iconResult.error !== undefined) throw iconResult.error
  if (iconResult.status !== 0) process.exit(iconResult.status ?? 1)
}

const builder = join(root, 'node_modules', '.bin', 'electron-builder')
// Packaging runs on tag commits; never let electron-builder infer a publish
// step from the tag. Releases are attached by the workflow instead.
const result = spawnSync(builder, [
  '--mac',
  `--${arch}`,
  '--publish',
  'never',
  `--config.extraMetadata.version=${version}`,
], {
  cwd: root,
  env: process.env.CSC_LINK || process.env.CSC_NAME
    ? { ...process.env }
    : { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

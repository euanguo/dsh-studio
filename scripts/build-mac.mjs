import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_STUDIO_PACKAGED_CHANNEL_FIELD } from '../src/data-root.ts'
import { resolveProductVersion } from '../src/version.ts'
import { parseMacBuildArguments } from './build-mac-args.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = resolveProductVersion(root)
const { requestedArch, channel } = parseMacBuildArguments(process.argv.slice(2))
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
const builderArgs = [
  '--mac',
  `--${arch}`,
  '--publish',
  'never',
  `--config.extraMetadata.version=${version}`,
]
if (channel === 'dev') {
  builderArgs.push(
    `--config.extraMetadata.${DSH_STUDIO_PACKAGED_CHANNEL_FIELD}=dev`,
    '--config.appId=ai.deepseek.dsh-studio.dev',
    '--config.productName=DSH Studio-Dev',
    '--config.artifactName=DSH-Studio-Dev-${version}-${arch}.${ext}',
    '--config.dmg.title=DSH Studio-Dev ${version}',
    '--config.dmg.artifactName=DSH-Studio-Dev-${version}-${arch}.${ext}',
  )
}
const result = spawnSync(builder, builderArgs, {
  cwd: root,
  env: process.env.CSC_LINK || process.env.CSC_NAME
    ? { ...process.env }
    : { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

// Post-pack size gate: the packaged app and its shipped runtime must stay
// inside the contract budgets; exceeding them fails the build.
const { verifyPackagedApplication } = await import('./runtime-contract.mjs')
const productFilename = channel === 'dev' ? 'DSH Studio-Dev' : 'DSH Studio'
const appBundle = join(root, 'release', `mac-${arch}`, `${productFilename}.app`)
const packReport = verifyPackagedApplication(appBundle, { platform: 'darwin' })
console.log(
  `Verified packaged app ${(packReport.app.bytes / 1048576).toFixed(1)} MiB / `
  + `${String(packReport.app.files)} files; runtime ${(packReport.runtime.bytes / 1048576).toFixed(1)} MiB / `
  + `${String(packReport.runtime.files)} files`,
)

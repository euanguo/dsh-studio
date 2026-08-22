import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProductVersion } from '../src/version.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = resolveProductVersion(root)
const requestedArch = process.argv[2]
const arch = requestedArch ?? { arm64: 'arm64', x64: 'x64' }[process.arch] ?? process.arch
if (arch !== 'x64') {
  throw new Error(`unsupported Windows architecture: ${arch}; only x64 is packaged`)
}

const electronPackage = join(root, 'node_modules', 'electron')
const electronBinary = join(electronPackage, 'dist', 'electron.exe')
if (!existsSync(electronBinary)) {
  const installResult = spawnSync(process.execPath, [join(electronPackage, 'install.js')], {
    cwd: root,
    stdio: 'inherit',
  })
  if (installResult.error !== undefined) throw installResult.error
  if (installResult.status !== 0) process.exit(installResult.status ?? 1)
}

// The `.bin` shim is a POSIX script; on Windows the package has no usable
// wrapper in PATH, so run the CLI entry with Node directly.
const builder = join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
// Packaging runs on tag commits; never let electron-builder infer a publish
// step from the tag. Releases are attached by the workflow instead.
const result = spawnSync(process.execPath, [
  builder,
  '--win',
  `--${arch}`,
  '--publish',
  'never',
  `--config.extraMetadata.version=${version}`,
], {
  cwd: root,
  env: process.env.CSC_LINK || process.env.WIN_CSC_LINK || process.env.CSC_NAME
    ? { ...process.env }
    : { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

// Post-pack size gate: the packaged app and its shipped runtime must stay
// inside the contract budgets; exceeding them fails the build.
const { verifyPackagedApplication } = await import('./runtime-contract.mjs')
const appBundle = join(root, 'release', 'win-unpacked')
const packReport = verifyPackagedApplication(appBundle, { platform: 'win32' })
console.log(
  `Verified packaged app ${(packReport.app.bytes / 1048576).toFixed(1)} MiB / `
  + `${String(packReport.app.files)} files; runtime ${(packReport.runtime.bytes / 1048576).toFixed(1)} MiB / `
  + `${String(packReport.runtime.files)} files`,
)
const installer = join(root, 'release', `DSH-Studio-${version}-x64.exe`)
if (!existsSync(installer)) throw new Error(`Windows NSIS installer was not produced: ${installer}`)
console.log(`Packaged DSH Studio ${version}: ${installer}`)

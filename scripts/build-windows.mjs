import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
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
const result = spawnSync(process.execPath, [builder, '--win', `--${arch}`, '--publish', 'never'], {
  cwd: root,
  env: {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  },
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

// electron-builder's NSIS/zip targets crash on the size of the bundled DSH
// runtime; the unpacked app is already complete, so zip it with the system
// bsdtar, which streams instead of materializing one giant argument string.
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const archive = join(root, 'release', `Oh-DSH-Desktop-${version}-x64.zip`)
spawnSync('tar', ['-a', '-cf', archive, 'win-unpacked'], {
  cwd: join(root, 'release'),
  stdio: 'inherit',
})
if (!existsSync(archive)) throw new Error(`Windows archive was not produced: ${archive}`)
console.log(`Packaged Oh-DSH-Desktop ${version}: ${archive}`)

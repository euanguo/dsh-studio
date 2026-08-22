const { spawnSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')
const {
  flipFuses,
  FuseV1Options,
  FuseVersion,
} = require('@electron/fuses')

/**
 * Fuses embed build-time security switches in the packaged Electron binary.
 * The desktop runtime depends on Electron-as-Node (RunAsNode stays true);
 * everything else is locked down: app code only loads from asar with
 * integrity validation, cookies are encrypted, and ambient NODE_OPTIONS or
 * --inspect arguments from the environment cannot reach the process.
 */
function electronBinaryFor(context) {
  const { electronPlatformName, appOutDir } = context
  const productFilename = context.packager.appInfo.productFilename
  if (electronPlatformName === 'darwin') {
    // @electron/fuses resolves the macOS fuse wire through the framework's
    // symlinked Electron Framework file itself; pass the .app bundle.
    return join(appOutDir, `${productFilename}.app`)
  }
  if (electronPlatformName === 'linux') {
    return join(appOutDir, 'dsh-studio')
  }
  return join(appOutDir, `${productFilename}.exe`)
}

function applyFuses(context) {
  const binary = electronBinaryFor(context)
  if (!existsSync(binary)) {
    throw new Error(`cannot apply fuses: Electron binary missing at ${binary}`)
  }
  // The version here is the fuse wire version (V1), not the Electron release,
  // and the fuse switches are top-level options (flat API). Production builds
  // are re-signed by electron-builder after this hook, covering the flipped
  // bytes; local ad-hoc builds skip fuses on macOS (see shouldApplyFuses).
  flipFuses(binary, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: true,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  })
  console.log(`Applied Electron fuses to ${binary}`)
}

/**
 * Fuses on arm64 macOS invalidate the framework's code-signature page hashes:
 * the kernel kills the app at the first fuse read ("Code Signature Invalid /
 * Invalid Page" at IsRunAsNodeEnabled) even after an ad-hoc re-sign. Local
 * test builds are ad-hoc-only, so macOS fuses are skipped there and only
 * applied under real signing (CSC_* / APPLE_ID), where electron-builder's own
 * signing step re-signs the flipped framework after this hook. Linux and
 * Windows carry no page-signature constraint and always fuse.
 */
function shouldApplyFuses(context) {
  if (context.electronPlatformName === 'darwin') {
    return Boolean(process.env.CSC_LINK || process.env.CSC_NAME || process.env.APPLE_ID)
  }
  return true
}

/**
 * Desktop packaging hook (every platform).
 *
 * 1. Replace the standalone Node binary with the shared-Node adapter set:
 *    the desktop app runs the DSH runtime on the Electron-embedded Node
 *    (ELECTRON_RUN_AS_NODE), so the ~115 MB standalone binary is dropped and
 *    `node`/`pnpm`/`pnpx`/`dsh` (+ `.cmd` on Windows) become small scripts
 *    re-executing the packaged Electron executable. Web/TUI distributions
 *    keep the real binary.
 * 2. Ad-hoc sign local macOS test builds before DMG/ZIP targets consume
 *    them; production CI signs and notarizes through electron-builder.
 */
module.exports = async function afterPack(context) {
  const { electronPlatformName, appOutDir } = context
  const productFilename = context.packager.appInfo.productFilename
  const { writeDesktopNodeAdapters } = await import('./prune-stage.mjs')

  const posixSuffix = (steps, name) => {
    const up = Array.from({ length: steps }, () => '..').join('/')
    return `/${up}/${name}`
  }
  const windowsFallback = (steps, name) => {
    const up = Array.from({ length: steps }, () => '..').join('\\')
    return `%~dp0${up}${up === '' ? '' : '\\'}${name}`
  }

  // Bundle-relative fallbacks per platform layout:
  //   darwin: <app>/Contents/Resources/node-runtime/bin
  //     -> ../../../MacOS/DSH Studio (bin up 3 = Contents, then MacOS)
  //   linux:  <app>/resources/node-runtime/bin -> <app>/dsh-studio
  //   win32:  <app>/resources/node-runtime/node.cmd
  //     -> <app>/DSH Studio.exe (up 2) and node_modules\pnpm beside it
  const fallbacks = {
    posixExecutableSuffix: electronPlatformName === 'darwin'
      ? posixSuffix(3, 'MacOS') + `/${productFilename}`
      : posixSuffix(3, productFilename),
    posixPnpmEntrySuffix: '/../lib/node_modules/pnpm/bin/pnpm.mjs',
    posixDshEntrySuffix: '/../../dsh-runtime/lib/bin.js',
    windowsExecutable: windowsFallback(2, `${productFilename}.exe`),
    windowsPnpmEntry: windowsFallback(0, 'node_modules\\pnpm\\bin\\pnpm.mjs'),
    windowsDshEntry: windowsFallback(1, 'dsh-runtime\\lib\\bin.js'),
  }

  const nodeRuntime = electronPlatformName === 'darwin'
    ? join(appOutDir, `${productFilename}.app`, 'Contents', 'Resources', 'node-runtime')
    : join(appOutDir, 'resources', 'node-runtime')
  const result = writeDesktopNodeAdapters(nodeRuntime, {
    platform: { darwin: 'darwin', linux: 'linux', win32: 'win32' }[electronPlatformName],
    fallbacks,
  })
  if (result.replacedBinary) {
    console.log(
      `Replaced standalone Node with shared-Node adapters `
      + `(${(result.removedBytes / 1048576).toFixed(1)} MB dropped)`,
    )
  }

  if (shouldApplyFuses(context)) {
    applyFuses(context)
  } else {
    console.log(`Skipped Electron fuses on ad-hoc ${electronPlatformName} build (arm64 signature constraint)`)
  }

  if (electronPlatformName !== 'darwin') return
  const appPath = join(appOutDir, `${productFilename}.app`)
  if (process.env.CSC_LINK || process.env.CSC_NAME || process.env.APPLE_ID) return
  const identity = process.env.DSH_STUDIO_SIGN_IDENTITY || '-'
  const args = ['--force', '--deep', '--sign', identity]
  if (identity === '-') args.push('--timestamp=none')
  args.push(appPath)
  const result1 = spawnSync('/usr/bin/codesign', args, { stdio: 'inherit' })
  if (result1.error !== undefined) throw result1.error
  if (result1.status !== 0) {
    throw new Error(`codesign failed with status ${String(result1.status)}`)
  }
}

const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

/**
 * Desktop packaging hook.
 *
 * 1. Replace the standalone Node binary with the shared-Node bridge: the
 *    desktop app runs the DSH runtime on the Electron-embedded Node
 *    (ELECTRON_RUN_AS_NODE), so the 114 MB standalone binary is dropped and
 *    `bin/node` becomes a script re-executing the packaged Electron
 *    executable. Web/TUI distributions keep the real binary.
 * 2. Ad-hoc sign local macOS test builds before DMG/ZIP targets consume
 *    them; production CI signs and notarizes through electron-builder.
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  )
  const nodeRuntime = join(appPath, 'Contents', 'Resources', 'node-runtime')
  const { writeDesktopNodeBridge } = await import('./prune-stage.mjs')
  const bridged = writeDesktopNodeBridge(
    nodeRuntime,
    `$(dirname "$0")/../../../MacOS/${context.packager.appInfo.productFilename}`,
  )
  if (bridged) console.log('Replaced standalone Node with shared-Node bridge')

  if (process.env.CSC_LINK || process.env.CSC_NAME || process.env.APPLE_ID) return
  const identity = process.env.DSH_STUDIO_SIGN_IDENTITY || '-'
  const args = ['--force', '--deep', '--sign', identity]
  if (identity === '-') args.push('--timestamp=none')
  args.push(appPath)
  const result = spawnSync('/usr/bin/codesign', args, { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`codesign failed with status ${String(result.status)}`)
  }
}

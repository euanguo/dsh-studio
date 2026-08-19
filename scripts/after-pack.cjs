const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

/** Ad-hoc sign local macOS test builds before DMG/ZIP targets consume them. */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  // Production CI signs and notarizes through electron-builder. The ad-hoc
  // fallback is only for local builds without a Developer ID certificate.
  if (process.env.CSC_LINK || process.env.CSC_NAME || process.env.APPLE_ID) return
  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  )
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

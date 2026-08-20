import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { verifyMetadata } from './update-metadata.mjs'

const args = process.argv.slice(2)
const value = name => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const dir = value('--dir')
const version = value('--version')
const platform = value('--platform')
if (dir === undefined || version === undefined || platform === undefined) {
  throw new Error('usage: verify-update-metadata.mjs --dir DIR --version VERSION --platform mac-arm64|mac-x64|win-x64|linux-x64')
}
const result = verifyMetadata({ dir, version, platform })
if (platform === 'linux-x64') {
  const deb = readdirSync(dir).find(name => name.startsWith(`DSH-Studio-${version}-`) && name.endsWith('.deb'))
  if (deb === undefined) throw new Error(`missing .deb asset for ${version}`)
  result.deb = join(dir, deb)
}
console.log(JSON.stringify(result, null, 2))

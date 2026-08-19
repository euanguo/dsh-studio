import { execFile } from 'node:child_process'
import {
  access,
  mkdir,
  rename,
  rm,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFile)
const APP_NAME = 'DSH Studio.app'
const EXECUTABLE_NAME = 'DSH Studio'
const BUNDLE_ID = 'ai.deepseek.dsh-studio'

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function validateMacBundle(path, options = {}) {
  const required = [
    join(path, 'Contents', 'MacOS', EXECUTABLE_NAME),
    join(
      path,
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Electron Framework',
    ),
    join(path, 'Contents', 'Resources', 'app.asar'),
  ]
  for (const candidate of required) {
    await access(candidate, constants.R_OK)
  }
  if (options.verifySignature !== false) {
    await execFileAsync('/usr/bin/codesign', [
      '--verify',
      '--deep',
      '--strict',
      path,
    ])
  }
}

function timestamp(date = new Date()) {
  const part = value => String(value).padStart(2, '0')
  return [
    String(date.getFullYear()),
    part(date.getMonth() + 1),
    part(date.getDate()),
    '-',
    part(date.getHours()),
    part(date.getMinutes()),
    part(date.getSeconds()),
  ].join('')
}

async function availableBackupPath(directory) {
  const stem = `DSH Studio-before-${timestamp()}`
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const name = suffix === 0 ? `${stem}.app` : `${stem}-${String(suffix)}.app`
    const candidate = join(directory, name)
    if (!await exists(candidate)) return candidate
  }
  throw new Error('unable to reserve an DSH Studio backup path')
}

export async function replaceMacBundle(options) {
  const source = resolve(options.source)
  const destination = resolve(options.destination)
  const backupDirectory = resolve(options.backupDirectory)
  const copyBundle = options.copyBundle
  const validateBundle = options.validateBundle ?? validateMacBundle
  const pending = join(
    dirname(destination),
    `.${basename(destination)}.install-${String(process.pid)}`,
  )
  let backup
  let previousMoved = false

  await validateBundle(source)
  await rm(pending, { force: true, recursive: true })
  try {
    await copyBundle(source, pending)
    await validateBundle(pending)
    await mkdir(backupDirectory, { recursive: true })
    if (await exists(destination)) {
      backup = await availableBackupPath(backupDirectory)
      await rename(destination, backup)
      previousMoved = true
    }
    try {
      await rename(pending, destination)
    } catch (error) {
      if (previousMoved && backup !== undefined) {
        await rename(backup, destination)
      }
      throw error
    }
    await validateBundle(destination)
    return { backup, destination }
  } finally {
    await rm(pending, { force: true, recursive: true })
  }
}

async function quitInstalledApp() {
  await execFileAsync('/usr/bin/osascript', [
    '-e',
    `tell application id "${BUNDLE_ID}" to quit`,
  ]).catch(() => {})
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { stdout } = await execFileAsync('/usr/bin/pgrep', [
      '-f',
      '/Applications/DSH Studio( Desktop|-Desktop).app/',
    ]).catch(() => ({ stdout: '' }))
    if (stdout.trim() === '') return
    await new Promise(resolveDelay => setTimeout(resolveDelay, 100))
  }
  throw new Error('DSH Studio did not quit cleanly')
}

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error('the local macOS installer only runs on macOS')
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const source = resolve(
    process.argv[2] ?? join(root, 'release', 'mac-arm64', APP_NAME),
  )
  const destination = join('/Applications', APP_NAME)
  await quitInstalledApp()
  const result = await replaceMacBundle({
    source,
    destination,
    backupDirectory: join(homedir(), '.Trash'),
    copyBundle: async (from, to) => {
      await execFileAsync('/usr/bin/ditto', [from, to])
    },
  })
  await execFileAsync('/usr/bin/open', ['-a', destination])
  process.stdout.write(`Installed ${destination}\n`)
  if (result.backup !== undefined) {
    process.stdout.write(`Previous app moved to ${result.backup}\n`)
  }
}

if (process.argv[1] !== undefined
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}

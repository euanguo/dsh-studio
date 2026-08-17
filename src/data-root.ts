import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import type { Stats } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Environment variable overriding the shared Oh-DSH state root. */
export const OH_DSH_HOME_ENV = 'OH_DSH_HOME'

/** Environment variable selecting the stable/dev data-root pair. */
export const OH_DSH_CHANNEL_ENV = 'OH_DSH_CHANNEL'

/** Installed Desktop and everyday Web/TUI state. */
export const OH_DSH_STABLE_CHANNEL = 'stable'

/** Source launches and verification instances. */
export const OH_DSH_DEV_CHANNEL = 'dev'

/** Channels that share one code path and differ only by data root. */
export const OH_DSH_CHANNELS = [OH_DSH_STABLE_CHANNEL, OH_DSH_DEV_CHANNEL] as const

/** Stable vs verification instance. Behavior is identical except the data root. */
export type OhDshChannel = (typeof OH_DSH_CHANNELS)[number]

/** Default directory shared by the Desktop, Web, and TUI surfaces. */
export const DEFAULT_OH_DSH_HOME_DIRECTORY = '.ohdsh'

/** Isolated sibling of the stable root for source and verification launches. */
export const DEFAULT_OH_DSH_DEV_HOME_DIRECTORY = '.ohdsh-dev'

/** Legacy desktop user-data directory used before the shared state root. */
export const LEGACY_DESKTOP_DATA_DIRECTORY = 'Oh-DSH-Desktop'

/** Legacy Web data directory used before the shared state root. */
export const LEGACY_WEB_DATA_DIRECTORY = '.oh-dsh-web'

const MIGRATIONS_DIRECTORY = '.migrations'
const DESKTOP_MIGRATION = 'desktop-state-v1.complete'
const WEB_DEFAULT_MIGRATION = 'web-default-v1.complete'
const WEB_FLAT_MIGRATION = 'web-flat-v1.complete'
const DESKTOP_SHARED_ENTRIES = new Set([
  'desktop-sidebar.json',
  'desktop-skins.json',
  'dsh',
  'logs',
  'plugin-marketplace',
  'sidebar.json',
  'skins.json',
])
const WEB_SHARED_ENTRIES = new Set([
  'desktop-sidebar.json',
  'desktop-skins.json',
  'sidebar.json',
  'skins.json',
])

/** Outcome of a legacy-state migration attempt. */
export interface LegacyStateMigrationResult {
  complete: boolean
  migrated: boolean
}

const NO_MIGRATION: LegacyStateMigrationResult = {
  complete: true,
  migrated: false,
}

const INCOMPLETE_MIGRATION: LegacyStateMigrationResult = {
  complete: false,
  migrated: false,
}

/** Directory name under the user home for one channel. */
export function ohDshHomeDirectory(channel: OhDshChannel = OH_DSH_STABLE_CHANNEL): string {
  return channel === OH_DSH_DEV_CHANNEL
    ? DEFAULT_OH_DSH_DEV_HOME_DIRECTORY
    : DEFAULT_OH_DSH_HOME_DIRECTORY
}

/** Normalize a user-supplied channel name. */
export function normalizeOhDshChannel(value: string): OhDshChannel | undefined {
  const normalized = value.trim().toLowerCase()
  if (normalized === OH_DSH_DEV_CHANNEL || normalized === 'development') {
    return OH_DSH_DEV_CHANNEL
  }
  if (
    normalized === OH_DSH_STABLE_CHANNEL
    || normalized === 'prod'
    || normalized === 'production'
  ) {
    return OH_DSH_STABLE_CHANNEL
  }
  return undefined
}

/** Parse a `--channel` / `OH_DSH_CHANNEL` value. */
export function parseOhDshChannel(value: string): OhDshChannel {
  const channel = normalizeOhDshChannel(value)
  if (channel === undefined) {
    throw new Error(
      `${OH_DSH_CHANNEL_ENV} must be "${OH_DSH_STABLE_CHANNEL}" or "${OH_DSH_DEV_CHANNEL}"`,
    )
  }
  return channel
}

/**
 * Pull `--channel` out of a launch argv so it is not treated as a file path.
 */
export function takeOhDshChannelArgs(args: readonly string[]): {
  channelValue: string | undefined
  rest: string[]
} {
  const rest: string[] = []
  let channelValue: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? ''
    if (argument === '--channel') {
      const value = args[index + 1]
      if (value === undefined || value === '' || value.startsWith('-')) {
        throw new Error('--channel needs a value')
      }
      channelValue = value
      index += 1
      continue
    }
    if (argument.startsWith('--channel=')) {
      channelValue = argument.slice('--channel='.length)
      continue
    }
    rest.push(argument)
  }
  return { channelValue, rest }
}

/**
 * Resolve the instance channel.
 *
 * An explicit `OH_DSH_CHANNEL` always wins. Unpackaged Desktop then defaults
 * to `dev` so a source verification instance does not share the installed
 * app's state. Web, TUI, and packaged Desktop stay on `stable`.
 */
export function resolveOhDshChannel(
  env: NodeJS.ProcessEnv = process.env,
  options: { packaged?: boolean } = {},
): OhDshChannel {
  const configured = env[OH_DSH_CHANNEL_ENV]
  if (configured !== undefined && configured !== '') return parseOhDshChannel(configured)
  return options.packaged === false ? OH_DSH_DEV_CHANNEL : OH_DSH_STABLE_CHANNEL
}

/** Resolve the default Oh-DSH state root for one user account. */
export function defaultOhDshHome(
  userHome: string = homedir(),
  channel: OhDshChannel = OH_DSH_STABLE_CHANNEL,
): string {
  return join(userHome, ohDshHomeDirectory(channel))
}

/** Resolve the shared state root, honoring the cross-surface override. */
export function resolveOhDshHome(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir(),
  channel?: OhDshChannel,
): string {
  const configured = env[OH_DSH_HOME_ENV]
  if (configured !== undefined && configured !== '') return resolve(configured)
  return resolve(defaultOhDshHome(
    userHome,
    channel ?? resolveOhDshChannel(env),
  ))
}

/** Whether a caller explicitly selected a shared state root. */
export function hasOhDshHomeOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const configured = env[OH_DSH_HOME_ENV]
  return configured !== undefined && configured !== ''
}

/** Whether this process may import legacy state into the resolved root. */
export function usesMigratableOhDshHome(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return !hasOhDshHomeOverride(env) && resolveOhDshChannel(env) === OH_DSH_STABLE_CHANNEL
}

/** Keep Electron's Chromium data contained below the shared state root. */
export function desktopElectronDataRoot(ohDshHome: string): string {
  return join(ohDshHome, 'desktop')
}

/** Resolve the legacy Web data root for one user account. */
export function legacyWebDataRoot(userHome: string = homedir()): string {
  return join(userHome, LEGACY_WEB_DATA_DIRECTORY)
}

function migrationMarker(root: string, name: string): string {
  return join(root, MIGRATIONS_DIRECTORY, name)
}

function stat(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function followedStat(path: string): Stats | undefined {
  try {
    return statSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function containsPath(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate)
  return path !== ''
    && path !== '..'
    && !path.startsWith(`..${sep}`)
    && !isAbsolute(path)
}

interface CopyRoots {
  destination: string
  source: string
}

function relocatedLinkTarget(
  source: string,
  destination: string,
  roots: CopyRoots | undefined,
  targetStat: Stats | undefined,
): { absolute: string; posix: string } {
  const original = readlinkSync(source)
  const lexicalTarget = isAbsolute(original)
    ? resolve(original)
    : resolve(realpathSync(dirname(source)), original)
  const canonicalTarget = targetStat === undefined
    ? lexicalTarget
    : realpathSync(source)
  const movesWithTree = roots !== undefined
    && (canonicalTarget === roots.source
      || containsPath(roots.source, canonicalTarget))
  const absolute = movesWithTree
    ? join(roots.destination, relative(roots.source, canonicalTarget))
    : canonicalTarget
  const posix = !movesWithTree && isAbsolute(original)
    ? original
    : relative(realpathSync(dirname(destination)), absolute) || '.'
  return { absolute, posix }
}

function copyEntry(
  source: string,
  destination: string,
  roots?: CopyRoots,
): boolean {
  const sourceStat = stat(source)
  if (sourceStat === undefined) return true
  const destinationStat = stat(destination)

  if (sourceStat.isDirectory()) {
    if (destinationStat !== undefined && !destinationStat.isDirectory()) return true
    mkdirSync(destination, { recursive: true, mode: sourceStat.mode & 0o777 })
    const copyRoots = roots ?? {
      destination: realpathSync(destination),
      source: realpathSync(source),
    }
    let copied = true
    for (const entry of readdirSync(source)) {
      copied = copyEntry(
        join(source, entry),
        join(destination, entry),
        copyRoots,
      ) && copied
    }
    return copied
  }

  if (sourceStat.isFile()) {
    if (destinationStat !== undefined && !destinationStat.isFile()) return true
    if (destinationStat !== undefined) return true
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
    try {
      copyFileSync(source, destination, fsConstants.COPYFILE_EXCL)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    return true
  }

  if (!sourceStat.isSymbolicLink() || destinationStat !== undefined) return true
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
  const targetStat = followedStat(source)
  const linkTarget = relocatedLinkTarget(source, destination, roots, targetStat)
  if (process.platform === 'win32') {
    if (targetStat === undefined) return false
    if (targetStat?.isDirectory() === true) {
      symlinkSync(linkTarget.absolute, destination, 'junction')
    } else if (targetStat?.isFile() === true) {
      try {
        copyFileSync(source, destination, fsConstants.COPYFILE_EXCL)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    return true
  }
  try {
    symlinkSync(
      linkTarget.posix,
      destination,
      targetStat?.isDirectory() === true ? 'dir' : 'file',
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return true
}

function copyDirectoryContents(
  source: string,
  destination: string,
  options: { exclude?: ReadonlySet<string> } = {},
): boolean {
  const sourceStat = followedStat(source)
  if (sourceStat === undefined || !sourceStat.isDirectory()) return false
  mkdirSync(destination, { recursive: true, mode: 0o700 })
  const sourceRoot = realpathSync(source)
  const destinationRoot = realpathSync(destination)
  if (sourceRoot === destinationRoot) return true
  if (containsPath(sourceRoot, destinationRoot)) return false
  const roots = { destination: destinationRoot, source: sourceRoot }
  let copied = true
  for (const entry of readdirSync(source)) {
    if (options.exclude?.has(entry) === true) continue
    copied = copyEntry(
      join(source, entry),
      join(destination, entry),
      roots,
    ) && copied
  }
  return copied
}

function completeMigration(root: string, name: string): void {
  const marker = migrationMarker(root, name)
  mkdirSync(dirname(marker), { recursive: true, mode: 0o700 })
  if (!existsSync(marker)) writeFileSync(marker, 'complete\n', { mode: 0o600 })
}

/**
 * Copy the pre-shared Desktop state into the new layout once.
 *
 * Existing shared state wins over every legacy entry. On a direct upgrade the
 * Electron-only directory is absent, so its Chromium state is still imported.
 */
export function migrateLegacyDesktopState(input: {
  appDataRoot: string
  env?: NodeJS.ProcessEnv
  ohDshHome: string
}): LegacyStateMigrationResult {
  if (!usesMigratableOhDshHome(input.env ?? process.env)) return NO_MIGRATION
  if (existsSync(migrationMarker(input.ohDshHome, DESKTOP_MIGRATION))) {
    return NO_MIGRATION
  }

  const legacyRoot = join(input.appDataRoot, LEGACY_DESKTOP_DATA_DIRECTORY)
  const legacyStat = followedStat(legacyRoot)
  if (legacyStat === undefined || !legacyStat.isDirectory()) return NO_MIGRATION

  const legacyDshHome = join(legacyRoot, 'dsh')
  if (stat(legacyDshHome) !== undefined
    && !copyDirectoryContents(legacyDshHome, input.ohDshHome)) {
    return INCOMPLETE_MIGRATION
  }
  let copiedSharedEntries = true
  for (const entry of DESKTOP_SHARED_ENTRIES) {
    if (entry === 'dsh') continue
    copiedSharedEntries = copyEntry(
      join(legacyRoot, entry),
      join(input.ohDshHome, entry),
    ) && copiedSharedEntries
  }
  if (!copiedSharedEntries) return INCOMPLETE_MIGRATION
  if (!copyDirectoryContents(
    legacyRoot,
    desktopElectronDataRoot(input.ohDshHome),
    { exclude: DESKTOP_SHARED_ENTRIES },
  )) return INCOMPLETE_MIGRATION
  completeMigration(input.ohDshHome, DESKTOP_MIGRATION)
  return { complete: true, migrated: true }
}

/**
 * Flatten legacy Web DSH homes and import the former default Web directory.
 * Legacy directories stay in place so users can still roll back safely.
 */
export function migrateLegacyWebState(input: {
  dataRoot: string
  legacyDefaultDataRoot?: string
}): LegacyStateMigrationResult {
  let migrated = false
  const flatMarker = migrationMarker(input.dataRoot, WEB_FLAT_MIGRATION)
  if (!existsSync(flatMarker)) {
    const flatSource = join(input.dataRoot, 'dsh')
    if (stat(flatSource) !== undefined) {
      if (!copyDirectoryContents(flatSource, input.dataRoot)) {
        return { complete: false, migrated }
      }
      completeMigration(input.dataRoot, WEB_FLAT_MIGRATION)
      migrated = true
    }
  }

  const legacyDefault = input.legacyDefaultDataRoot
  const defaultMarker = migrationMarker(input.dataRoot, WEB_DEFAULT_MIGRATION)
  if (legacyDefault !== undefined
    && resolve(legacyDefault) !== resolve(input.dataRoot)
    && !existsSync(defaultMarker)) {
    const legacyDshHome = join(legacyDefault, 'dsh')
    const hasLegacyDshHome = stat(legacyDshHome) !== undefined
    const copiedLegacyDshHome = !hasLegacyDshHome
      || copyDirectoryContents(legacyDshHome, input.dataRoot)
    if (!copiedLegacyDshHome) return { complete: false, migrated }
    let foundLegacyState = hasLegacyDshHome
    let copiedSharedEntries = true
    for (const entry of WEB_SHARED_ENTRIES) {
      const source = join(legacyDefault, entry)
      if (stat(source) === undefined) continue
      foundLegacyState = true
      copiedSharedEntries = copyEntry(
        source,
        join(input.dataRoot, entry),
      ) && copiedSharedEntries
    }
    if (!copiedSharedEntries) return { complete: false, migrated }
    if (foundLegacyState && copiedSharedEntries) {
      completeMigration(input.dataRoot, WEB_DEFAULT_MIGRATION)
      migrated = true
    }
  }
  return { complete: true, migrated }
}

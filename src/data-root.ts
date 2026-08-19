import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Environment variable overriding the shared DSH Studio state root. */
export const DSH_STUDIO_HOME_ENV = 'DSH_STUDIO_HOME'

/** Environment variable selecting the stable/dev data-root pair. */
export const DSH_STUDIO_CHANNEL_ENV = 'DSH_STUDIO_CHANNEL'

/** Installed Desktop and everyday Web/TUI state. */
export const DSH_STUDIO_STABLE_CHANNEL = 'stable'

/** Source launches and verification instances. */
export const DSH_STUDIO_DEV_CHANNEL = 'dev'

/** Channels that share one code path and differ only by data root. */
export const DSH_STUDIO_CHANNELS = [DSH_STUDIO_STABLE_CHANNEL, DSH_STUDIO_DEV_CHANNEL] as const

/** Stable vs verification instance. Behavior is identical except the data root. */
export type DshStudioChannel = (typeof DSH_STUDIO_CHANNELS)[number]

/** Default directory shared by the Desktop, Web, and TUI surfaces. */
export const DEFAULT_DSH_STUDIO_HOME_DIRECTORY = '.dsh-studio'

/** Isolated sibling of the stable root for source and verification launches. */
export const DEFAULT_DSH_STUDIO_DEV_HOME_DIRECTORY = '.dsh-studio-dev'

/** Directory name under the user home for one channel. */
export function dshStudioHomeDirectory(channel: DshStudioChannel = DSH_STUDIO_STABLE_CHANNEL): string {
  return channel === DSH_STUDIO_DEV_CHANNEL
    ? DEFAULT_DSH_STUDIO_DEV_HOME_DIRECTORY
    : DEFAULT_DSH_STUDIO_HOME_DIRECTORY
}

/** Normalize a user-supplied channel name. */
export function normalizeDshStudioChannel(value: string): DshStudioChannel | undefined {
  const normalized = value.trim().toLowerCase()
  if (normalized === DSH_STUDIO_DEV_CHANNEL || normalized === 'development') {
    return DSH_STUDIO_DEV_CHANNEL
  }
  if (
    normalized === DSH_STUDIO_STABLE_CHANNEL
    || normalized === 'prod'
    || normalized === 'production'
  ) {
    return DSH_STUDIO_STABLE_CHANNEL
  }
  return undefined
}

/** Parse a `--channel` / `DSH_STUDIO_CHANNEL` value. */
export function parseDshStudioChannel(value: string): DshStudioChannel {
  const channel = normalizeDshStudioChannel(value)
  if (channel === undefined) {
    throw new Error(
      `${DSH_STUDIO_CHANNEL_ENV} must be "${DSH_STUDIO_STABLE_CHANNEL}" or "${DSH_STUDIO_DEV_CHANNEL}"`,
    )
  }
  return channel
}

/** Pull `--channel` out of launch args so it is not treated as a file path. */
export function takeDshStudioChannelArgs(args: readonly string[]): {
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

/** Resolve the instance channel. */
export function resolveDshStudioChannel(
  env: NodeJS.ProcessEnv = process.env,
  options: { packaged?: boolean } = {},
): DshStudioChannel {
  const configured = env[DSH_STUDIO_CHANNEL_ENV]
  if (configured !== undefined && configured !== '') return parseDshStudioChannel(configured)
  return options.packaged === false ? DSH_STUDIO_DEV_CHANNEL : DSH_STUDIO_STABLE_CHANNEL
}

/** Resolve the default DSH Studio state root for one user account. */
export function defaultDshStudioHome(
  userHome: string = homedir(),
  channel: DshStudioChannel = DSH_STUDIO_STABLE_CHANNEL,
): string {
  return join(userHome, dshStudioHomeDirectory(channel))
}

/** Resolve the shared state root, honoring the cross-surface override. */
export function resolveDshStudioHome(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir(),
  channel?: DshStudioChannel,
): string {
  const configured = env[DSH_STUDIO_HOME_ENV]
  if (configured !== undefined && configured !== '') return resolve(configured)
  return resolve(defaultDshStudioHome(
    userHome,
    channel ?? resolveDshStudioChannel(env),
  ))
}

/** Whether a caller explicitly selected a shared state root. */
export function hasDshStudioHomeOverride(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const configured = env[DSH_STUDIO_HOME_ENV]
  return configured !== undefined && configured !== ''
}

/** Keep Electron's Chromium data contained below the shared state root. */
export function desktopElectronDataRoot(dshStudioHome: string): string {
  return join(dshStudioHome, 'desktop')
}

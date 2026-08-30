/** Unified launcher for the DSH Studio interaction surfaces. */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  DSH_STUDIO_CHANNEL_ENV,
  DSH_STUDIO_HOME_ENV,
  parseDshStudioChannel,
  takeDshStudioChannelArgs,
  type DshStudioChannel,
} from './data-root.ts'
import { UsageError } from './errors.ts'
import { main as runTui } from './tui.ts'
import { main as runWeb } from './web.ts'

const SURFACE_NAMES = ['desktop', 'web', 'tui'] as const
type SurfaceName = typeof SURFACE_NAMES[number]
const SURFACE_ALIASES: Readonly<Record<string, SurfaceName>> = Object.freeze({
  gui: 'desktop',
})

export function availableSurfaces(env: NodeJS.ProcessEnv = process.env): readonly SurfaceName[] {
  const configured = env.DSH_STUDIO_SURFACES
  if (configured === undefined || configured === '') return SURFACE_NAMES
  const requested = new Set(configured.split(',').map(value => value.trim()))
  return SURFACE_NAMES.filter(surface => requested.has(surface))
}

export function cliHelp(env: NodeJS.ProcessEnv = process.env): string {
  const surfaces = availableSurfaces(env)
  const aliases = Object.entries(SURFACE_ALIASES)
    .filter(([, surface]) => surfaces.includes(surface))
  const descriptions: Record<SurfaceName, string> = {
    desktop: 'Start DSH Studio',
    web: 'Start DSH Studio Web',
    tui: 'Start DSH Studio TUI',
  }
  return `DSH Studio launcher

Usage:
  dsh-studio <surface> [options]

Surfaces:
${surfaces.map(surface => `  ${surface.padEnd(9)} ${descriptions[surface]}`).join('\n')}
${aliases.length === 0 ? '' : `\nAliases:\n${aliases.map(([alias, surface]) => `  ${alias.padEnd(9)} ${descriptions[surface]}`).join('\n')}`}

Run "dsh-studio <surface> --help" for surface options.
`
}

export const DESKTOP_USAGE = `usage: dsh-studio desktop [options]

Options:
  --channel <stable|dev>  isolate state (packaged default: stable; source default: dev)
  --help                  show this help

Environment:
  DSH_STUDIO_HOME, DSH_STUDIO_CHANNEL, DSH_STUDIO_DESKTOP_APP, DSH_STUDIO_SOURCE_ROOT
`

export interface DesktopLaunchOptions {
  channel?: DshStudioChannel
  help: boolean
  rest: string[]
}

/** Resolve desktop launcher flags without starting a process. */
export function parseDesktopLaunchArgs(args: readonly string[]): DesktopLaunchOptions {
  let taken: ReturnType<typeof takeDshStudioChannelArgs>
  try {
    taken = takeDshStudioChannelArgs(args)
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
  const rest: string[] = []
  let help = false
  for (const argument of taken.rest) {
    if (argument === '--help' || argument === '-h') {
      help = true
      continue
    }
    rest.push(argument)
  }
  if (taken.channelValue === undefined) return { help, rest }
  try {
    return { channel: parseDshStudioChannel(taken.channelValue), help, rest }
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }
}

export interface DesktopLaunchSpec {
  args: string[]
  command: string
  cwd?: string
}

type WebRunner = typeof runWeb
type TuiRunner = typeof runTui
type DesktopRunner = (
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<number>

function sourceElectron(
  root: string,
  platform: NodeJS.Platform,
): string {
  const paths = platform === 'win32' ? win32 : posix
  if (platform === 'darwin') {
    return paths.join(
      root,
      'node_modules',
      'electron',
      'dist',
      'Electron.app',
      'Contents',
      'MacOS',
      'Electron',
    )
  }
  return paths.join(
    root,
    'node_modules',
    'electron',
    'dist',
    platform === 'win32' ? 'electron.exe' : 'electron',
  )
}

function macOpenEnvironment(env: NodeJS.ProcessEnv): string[] {
  const extras: string[] = []
  const dshStudioHome = env[DSH_STUDIO_HOME_ENV]
  if (dshStudioHome !== undefined && dshStudioHome !== '') {
    extras.push('--env', `${DSH_STUDIO_HOME_ENV}=${posix.resolve(dshStudioHome)}`)
  }
  const channel = env[DSH_STUDIO_CHANNEL_ENV]
  if (channel !== undefined && channel !== '') {
    extras.push('--env', `${DSH_STUDIO_CHANNEL_ENV}=${channel}`)
  }
  return extras
}

/** Resolve one desktop launch without starting a process. */
export function desktopLaunchSpec(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  pathExists: (path: string) => boolean = existsSync,
): DesktopLaunchSpec {
  const paths = platform === 'win32' ? win32 : posix
  const explicitApp = env.DSH_STUDIO_DESKTOP_APP
  if (explicitApp !== undefined && explicitApp !== '') {
    if (platform === 'darwin') {
      return {
        args: [
          ...macOpenEnvironment(env),
          paths.resolve(explicitApp),
          ...(args.length === 0 ? [] : ['--args', ...args]),
        ],
        command: '/usr/bin/open',
      }
    }
    return { args: [...args], command: paths.resolve(explicitApp) }
  }

  const sourceRoot = env.DSH_STUDIO_SOURCE_ROOT
  if (sourceRoot !== undefined && sourceRoot !== '') {
    const root = paths.resolve(sourceRoot)
    const electron = sourceElectron(root, platform)
    if (pathExists(electron)) {
      return {
        args: [root, ...args],
        command: electron,
        cwd: root,
      }
    }
  }

  if (platform === 'darwin') {
    return {
      args: [
        ...macOpenEnvironment(env),
        '-a',
        'DSH Studio',
        ...(args.length === 0 ? [] : ['--args', ...args]),
      ],
      command: '/usr/bin/open',
    }
  }
  if (platform === 'win32') {
    return {
      args: ['/d', '/s', '/c', 'start', '""', 'DSH Studio.exe', ...args],
      command: env.ComSpec ?? 'cmd.exe',
    }
  }
  return { args: [...args], command: 'dsh-studio' }
}

/** Start the desktop surface and detach the launcher. */
export async function launchDesktop(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const spec = desktopLaunchSpec(args, env)
  return await new Promise<number>((resolveLaunch, rejectLaunch) => {
    const child = spawn(spec.command, spec.args, {
      ...(spec.cwd === undefined ? {} : { cwd: spec.cwd }),
      detached: true,
      env,
      stdio: 'ignore',
    })
    child.once('error', rejectLaunch)
    child.once('spawn', () => {
      child.unref()
      resolveLaunch(0)
    })
  })
}

/** Dispatch one surface command. */
export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  stdout: NodeJS.WriteStream = process.stdout,
  stderr: NodeJS.WriteStream = process.stderr,
  desktopRunner: DesktopRunner = launchDesktop,
  webRunner: WebRunner = runWeb,
  tuiRunner: TuiRunner = runTui,
): Promise<number> {
  const [surface, ...args] = argv
  const selectedSurface = surface === undefined
    ? undefined
    : SURFACE_ALIASES[surface] ?? surface
  const help = cliHelp(env)
  if (surface === undefined || surface === '--help' || surface === '-h') {
    stdout.write(help)
    return 0
  }
  if (SURFACE_NAMES.includes(selectedSurface as SurfaceName)
    && !availableSurfaces(env).includes(selectedSurface as SurfaceName)) {
    stderr.write(`Surface '${surface}' is not included in this DSH Studio distribution.\n\n${help}`)
    return 2
  }
  if (selectedSurface === 'desktop') {
    const parsed = parseDesktopLaunchArgs(args)
    if (parsed.help) {
      stdout.write(DESKTOP_USAGE)
      return 0
    }
    const childEnv = parsed.channel === undefined
      ? env
      : { ...env, [DSH_STUDIO_CHANNEL_ENV]: parsed.channel }
    return await desktopRunner(parsed.rest, childEnv)
  }
  if (selectedSurface === 'web') return await webRunner(args, env, stdout)
  if (selectedSurface === 'tui') return await tuiRunner(args, env, stdout, stderr)
  stderr.write(`Unknown surface: ${surface}\n\n${help}`)
  return 2
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main(process.argv.slice(2)).then(code => {
    process.exit(code)
  }, error => {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`)
      process.exit(2)
    }
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    )
    process.exit(1)
  })
}

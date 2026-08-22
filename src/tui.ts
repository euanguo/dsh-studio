/** DSH Studio TUI launcher over the pinned upstream dsh-TUI bundle. */

import { spawn, type SpawnOptions } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { defaultDshStudioHome, hasDshStudioHomeOverride, parseDshStudioChannel, resolveDshStudioHome } from './data-root.ts'
import { UsageError } from './errors.ts'
import { ensureTuiProfile, TUI_PROFILE } from './profile.ts'
import {
  bundledRuntimePaths,
  runtimeSearchPath,
  type BundledRuntimePaths,
} from './runtime-paths.ts'
import { resolveProductVersion } from './version.ts'

/** Default DSH Studio-owned home, isolated from the upstream DSH CLI. */
export const DEFAULT_TUI_HOME = defaultDshStudioHome()

/** TUI launch options resolved from command-line flags and environment. */
export interface TuiLaunchOptions {
  cwd: string
  dataRoot: string
  fullscreen: boolean
  help: boolean
  lang?: 'en' | 'zh'
  preset?: string
  sessionId?: string
}

/** One attached TUI child-process plan. */
export interface TuiLaunchSpec {
  args: string[]
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  spawnOptions: SpawnOptions
}

export type TuiSpawner = typeof spawn

const USAGE = `usage: dsh-studio tui [options]

Options:
  --cwd <dir>            workspace directory (default: current directory)
  --data <dir>           DSH home and session store (default: ~/.dsh-studio)
  --channel <stable|dev> isolate state (default: stable; dev uses ~/.dsh-studio-dev)
  --resume <session>     resume an existing session id
  --lang <zh|en>         initial interface language
  --preset <name>        initial agent preset
  --fullscreen           use the alternate screen (default)
  --inline               keep terminal scrollback instead
  --help                 show this help

Environment:
  DSH_STUDIO_HOME, DSH_STUDIO_CHANNEL, DSH_STUDIO_TUI_HOME, DSH_STUDIO_TUI_CWD, DSH_STUDIO_TUI_FULLSCREEN,
  DSH_STUDIO_TUI_LANG, DSH_STUDIO_TUI_PRESET, DSH_STUDIO_TUI_SESSION_ID
`

function parseBoolean(value: string, name: string): boolean {
  if (value === '1' || value.toLowerCase() === 'true') return true
  if (value === '0' || value.toLowerCase() === 'false') return false
  throw new UsageError(`invalid ${name} value: ${value}`)
}

function optionalEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]
  return value === undefined || value === '' ? undefined : value
}

function language(value: string): 'en' | 'zh' {
  if (value === 'en' || value === 'zh') return value
  throw new UsageError(`invalid TUI language: ${value}`)
}

/** Resolve TUI options without touching the filesystem or spawning DSH. */
export function parseTuiArgs(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  defaultCwd: string = process.cwd(),
  defaultDataRoot: string = DEFAULT_TUI_HOME,
): TuiLaunchOptions {
  const envFullscreen = optionalEnv(env, 'DSH_STUDIO_TUI_FULLSCREEN')
  const envLang = optionalEnv(env, 'DSH_STUDIO_TUI_LANG')
  const envPreset = optionalEnv(env, 'DSH_STUDIO_TUI_PRESET')
  const envSessionId = optionalEnv(env, 'DSH_STUDIO_TUI_SESSION_ID')
  const options: TuiLaunchOptions = {
    cwd: optionalEnv(env, 'DSH_STUDIO_TUI_CWD') ?? defaultCwd,
    dataRoot: optionalEnv(env, 'DSH_STUDIO_TUI_HOME')
      ?? optionalEnv(env, 'DSH_STUDIO_HOME')
      ?? (optionalEnv(env, 'DSH_STUDIO_CHANNEL') === undefined
        ? defaultDataRoot
        : resolveDshStudioHome(env)),
    fullscreen: envFullscreen === undefined
      ? true
      : parseBoolean(envFullscreen, 'DSH_STUDIO_TUI_FULLSCREEN'),
    help: false,
    ...(envLang === undefined ? {} : { lang: language(envLang) }),
    ...(envPreset === undefined ? {} : { preset: envPreset }),
    ...(envSessionId === undefined ? {} : { sessionId: envSessionId }),
  }
  let explicitData = optionalEnv(env, 'DSH_STUDIO_TUI_HOME') !== undefined
    || optionalEnv(env, 'DSH_STUDIO_HOME') !== undefined
  let channel: ReturnType<typeof parseDshStudioChannel> | undefined

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? ''
    if (argument === '--help' || argument === '-h') {
      options.help = true
      continue
    }
    if (argument === '--fullscreen') {
      options.fullscreen = true
      continue
    }
    if (argument === '--inline') {
      options.fullscreen = false
      continue
    }
    const flag = (name: string): string | undefined => {
      if (argument === name) {
        const value = args[index + 1]
        if (value === undefined || value === '') throw new UsageError(`${name} needs a value`)
        index += 1
        return value
      }
      if (argument.startsWith(`${name}=`)) {
        const value = argument.slice(name.length + 1)
        if (value === '') throw new UsageError(`${name} needs a value`)
        return value
      }
      return undefined
    }
    const cwd = flag('--cwd')
    if (cwd !== undefined) {
      options.cwd = cwd
      continue
    }
    const data = flag('--data')
    if (data !== undefined) {
      options.dataRoot = data
      explicitData = true
      continue
    }
    const channelValue = flag('--channel')
    if (channelValue !== undefined) {
      try {
        channel = parseDshStudioChannel(channelValue)
      } catch (error) {
        throw new UsageError(error instanceof Error ? error.message : String(error))
      }
      continue
    }
    const sessionId = flag('--resume')
    if (sessionId !== undefined) {
      options.sessionId = sessionId
      continue
    }
    const lang = flag('--lang')
    if (lang !== undefined) {
      options.lang = language(lang)
      continue
    }
    const preset = flag('--preset')
    if (preset !== undefined) {
      options.preset = preset
      continue
    }
    throw new UsageError(`unknown option: ${argument}`)
  }
  if (channel !== undefined && !explicitData && !hasDshStudioHomeOverride(env)) {
    options.dataRoot = defaultDshStudioHome(undefined, channel)
  }
  return options
}

/** Resolve the installed distribution root or the repository root. */
export function resolveTuiRoot(env: NodeJS.ProcessEnv = process.env): string {
  for (const name of ['DSH_STUDIO_TUI_ROOT', 'DSH_STUDIO_SOURCE_ROOT'] as const) {
    const value = env[name]
    if (value !== undefined && value !== '') return resolve(value)
  }
  return dirname(dirname(fileURLToPath(import.meta.url)))
}

/** Read release metadata from a standalone package or Electron resources. */
export function resolveTuiVersion(root: string): string {
  return resolveProductVersion(root)
}

/** Build one attached process launch after the profile has been initialized. */
export function tuiLaunchSpec(
  options: TuiLaunchOptions,
  env: NodeJS.ProcessEnv,
  paths: BundledRuntimePaths,
  version: string,
): TuiLaunchSpec {
  const dataRoot = resolve(options.dataRoot)
  const cwd = resolve(options.cwd)
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    CC_TUI_LANG: options.lang,
    CC_TUI_PRESET: options.preset,
    DSH_CC_RESUME_SESSION: options.sessionId,
    DSH_HOME: dataRoot,
    DSH_STUDIO_TUI: '1',
    DSH_STUDIO_TUI_HOME: dataRoot,
    DSH_STUDIO_TUI_PROFILE: TUI_PROFILE,
    DSH_STUDIO_TUI_VERSION: version,
    DSH_STUDIO_TUI_CONFIG_HOME: join(dataRoot, 'tui'),
    DSH_STUDIO_TUI_CWD: cwd,
    DSH_STUDIO_TUI_FULLSCREEN: options.fullscreen ? '1' : '0',
    DSH_STUDIO_TUI_LANG: options.lang,
    DSH_STUDIO_TUI_PRESET: options.preset,
    DSH_STUDIO_TUI_SESSION_ID: options.sessionId,
    DSH_STUDIO_TUI_TITLE: 'DSH Studio TUI',
    DSH_STUDIO_HOME: dataRoot,
    PATH: runtimeSearchPath(paths, env),
  }
  // When this process already runs on the shared Electron interpreter
  // (packaged desktop CLI via the node bridge), spawn the child the same
  // way — process.execPath is the interpreter and ELECTRON_RUN_AS_NODE is
  // inherited in childEnv. Otherwise the standalone node binary is used
  // (Web/headless distributions have no Electron).
  const command = env.ELECTRON_RUN_AS_NODE === '1' ? process.execPath : paths.nodeBinary
  return {
    args: [paths.cliEntry, '--profile', TUI_PROFILE],
    command,
    cwd,
    env: childEnv,
    spawnOptions: {
      cwd,
      env: childEnv,
      stdio: 'inherit',
    },
  }
}

/** Start the TUI in the caller's terminal and return its exit status. */
export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  stdout: NodeJS.WriteStream = process.stdout,
  stderr: NodeJS.WriteStream = process.stderr,
  spawnTui: TuiSpawner = spawn,
  stdin: Readable & { isTTY?: boolean } = process.stdin,
): Promise<number> {
  const options = parseTuiArgs(argv, env)
  if (options.help) {
    stdout.write(USAGE)
    return 0
  }
  if (stdin.isTTY !== true || stdout.isTTY !== true) {
    stderr.write('DSH Studio TUI requires an interactive terminal.\n')
    return 2
  }

  const root = resolveTuiRoot(env)
  const stagedNode = process.platform === 'win32'
    ? join(root, '.stage', 'node-runtime', 'node.exe')
    : join(root, '.stage', 'node-runtime', 'bin', 'node')
  const resourcesRoot = env.DSH_STUDIO_TUI_ROOT !== undefined
    ? root
    : existsSync(stagedNode)
      ? join(root, '.stage')
      : root
  const paths = bundledRuntimePaths(resourcesRoot)
  if (!existsSync(paths.nodeBinary)) {
    throw new Error(`packaged Node runtime is missing: ${paths.nodeBinary}`)
  }
  if (!existsSync(paths.cliEntry)) {
    throw new Error(`packaged DSH CLI is missing: ${paths.cliEntry}`)
  }

  const dataRoot = resolve(options.dataRoot)
  const cwd = resolve(options.cwd)
  if (!existsSync(cwd)) throw new UsageError(`workspace directory does not exist: ${cwd}`)
  mkdirSync(dataRoot, { recursive: true, mode: 0o700 })
  ensureTuiProfile(dataRoot)

  const spec = tuiLaunchSpec(
    { ...options, cwd, dataRoot },
    env,
    paths,
    resolveTuiVersion(root),
  )
  return await new Promise<number>((resolveExit, rejectExit) => {
    const child = spawnTui(spec.command, spec.args, spec.spawnOptions)
    child.once('error', rejectExit)
    child.once('exit', (code, signal) => {
      resolveExit(code ?? (signal === null ? 1 : 128))
    })
  })
}

/**
 * DSH runtime option and environment assembly (kernel-refactor leaf-2.3,
 * target-design §4.2). Owns the shared option scaffolding for the live
 * runtime and the sandboxed marketplace-preview runtime, plus the scoped
 * environment composition both of them build on.
 *
 * The module holds no lifecycle state: every host-specific fact (bundled
 * paths, desktop info, the marketplace agent gateway, the resolved user
 * environment, logging) arrives through RuntimeOptionsHost, which
 * src/main.ts supplies at composition time.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  MARKETPLACE_AGENT_TOKEN_ENV,
  MARKETPLACE_AGENT_URL_ENV,
} from '../plugins/plugin-marketplace/src/host/agent-gateway.ts'
import {
  previewSandboxPolicy,
} from '../plugins/plugin-marketplace/src/host/platform.ts'
import type { PreviewRuntimeRequest } from './app-controller.ts'
import type { DesktopInfo } from './contracts.ts'
import {
  desktopInterpreterSpawnEnv,
  desktopNodeEnv,
  desktopNodeLauncher,
} from './desktop-node-env.ts'
import { ensureEnvScrubModule } from './env-scrub.ts'
import {
  buildDesktopRuntimeEnvironment,
  type RuntimeEnvironmentScope,
} from './runtime-environment.ts'
import {
  nodeInterpreterAvailable,
  type BundledRuntimePaths,
} from './runtime-paths.ts'
import { DESKTOP_PROFILE } from './profile.ts'
import type { DshRuntimeOptions, RuntimeLauncher } from './runtime.ts'
import type { UserEnvironmentResolution } from './user-environment.ts'

/** Host-provided facts this module composes runtime options from. */
export interface RuntimeOptionsHost {
  paths(): BundledRuntimePaths
  desktopInfo(): DesktopInfo
  /** Marketplace agent gateway coordinates when one is running. */
  marketplaceAgentGateway(): { url: string; token: string } | undefined
  /** Already-resolved user environment (never the raw fallback decision). */
  userEnvironment(): UserEnvironmentResolution
  log(stream: 'desktop' | 'stderr' | 'stdout', line: string): void
}

/**
 * Shared DSH runtime option scaffolding used by both the live runtime and the
 * marketplace preview runtime. Each caller supplies the environment, working
 * directory, scrub module, and launcher that differ between the two.
 */
export function baseRuntimeOptions(input: {
  cwd: string
  env: NodeJS.ProcessEnv
  launcher?: RuntimeLauncher | undefined
  onLog?: (stream: 'desktop' | 'stderr' | 'stdout', line: string) => void
  paths: BundledRuntimePaths
  readyTimeoutMs: number
  scrubModule: string | null
}): DshRuntimeOptions {
  if (!nodeInterpreterAvailable(input.paths)) {
    throw new Error(`packaged Node interpreter is missing: ${input.paths.nodeCommand}`)
  }
  if (!existsSync(input.paths.cliEntry)) {
    throw new Error(`packaged DSH CLI is missing: ${input.paths.cliEntry}`)
  }
  // The loader/HMR service accesses Node internals; both the standalone
  // binary and the shared Electron interpreter honor this flag. The require
  // preload binds the interpreter variables to this launch (a missing scrub
  // module degrades to legacy inheritance, never a crash).
  return {
    args: ['--profile', DESKTOP_PROFILE],
    cliEntry: input.paths.cliEntry,
    nodeFlags: [
      '--expose-internals',
      ...(input.scrubModule === null ? [] : ['--require', input.scrubModule]),
    ],
    cwd: input.cwd,
    env: input.env,
    ...(input.launcher === undefined ? {} : { launcher: input.launcher }),
    nodeBinary: input.paths.nodeCommand,
    ...(input.onLog === undefined ? {} : { onLog: input.onLog }),
    readyTimeoutMs: input.readyTimeoutMs,
  }
}

export interface RuntimeOptionsModule {
  /**
   * Scoped runtime environment for child processes (live scope by default,
   * isolated marketplace scope on request).
   */
  runtimeEnvironment(
    paths: BundledRuntimePaths,
    overrides?: {
      appDataPath?: string
      dshHome?: string
      preview?: { pluginId: string; transactionId: string }
    },
    scope?: RuntimeEnvironmentScope,
  ): NodeJS.ProcessEnv
  /** Options for a fresh live-runtime supervisor launch. */
  runtimeOptions(): DshRuntimeOptions
  /** Options for a fresh sandboxed marketplace-preview supervisor launch. */
  previewRuntimeOptions(request: PreviewRuntimeRequest): DshRuntimeOptions
}

export function createRuntimeOptionsModule(host: RuntimeOptionsHost): RuntimeOptionsModule {
  function runtimeEnvironment(
    paths: BundledRuntimePaths,
    overrides: Parameters<RuntimeOptionsModule['runtimeEnvironment']>[1] = {},
    scope: RuntimeEnvironmentScope = 'user',
  ): NodeJS.ProcessEnv {
    const info = host.desktopInfo()
    const gateway = overrides.preview === undefined ? host.marketplaceAgentGateway() : undefined
    const environment = buildDesktopRuntimeEnvironment({
      appDataPath: overrides.appDataPath ?? info.appDataPath,
      dshHome: overrides.dshHome ?? info.dshHome,
      ...(gateway === undefined ? {} : {
        extraEnvironment: {
          [MARKETPLACE_AGENT_URL_ENV]: gateway.url,
          [MARKETPLACE_AGENT_TOKEN_ENV]: gateway.token,
        },
      }),
      nodeEnvironment: desktopNodeEnv(paths, process.execPath),
      paths,
      ...(overrides.preview === undefined ? {} : { preview: overrides.preview }),
      profile: info.profile,
      scope,
      userEnvironment: host.userEnvironment(),
      version: info.version,
    })
    return environment
  }

  function runtimeOptions(): DshRuntimeOptions {
    const paths = host.paths()
    const workspaceRoot = join(homedir(), 'DSH Workspaces')
    mkdirSync(workspaceRoot, { recursive: true })
    // The interpreter exec boundary puts ELECTRON_RUN_AS_NODE into the
    // supervisor's own environment (the launcher below); the preload then
    // deletes it from process.env at boot, so bundled runtime descendants —
    // agent sessions and their tool shells above all — inherit only the user
    // environment plus namespaced DSH_* variables. Without the scrub, the
    // variable leaks into every command the agent runs and silently flips any
    // Electron binary those commands launch into plain-Node mode.
    const envScrubModule = ensureEnvScrubModule(host.desktopInfo().appDataPath)
    return baseRuntimeOptions({
      cwd: workspaceRoot,
      env: runtimeEnvironment(paths),
      onLog: (stream, line) => { host.log(stream, line) },
      paths,
      readyTimeoutMs: 60_000,
      scrubModule: envScrubModule,
    })
  }

  function previewRuntimeOptions(request: PreviewRuntimeRequest): DshRuntimeOptions {
    const paths = host.paths()
    const workspaceRoot = join(request.sandboxRoot, 'workspace')
    const temporary = join(request.sandboxRoot, '.tmp')
    mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 })
    mkdirSync(temporary, { recursive: true, mode: 0o700 })
    const preview = { pluginId: request.pluginId, transactionId: request.transactionId }
    const sandbox = '/usr/bin/sandbox-exec'
    const previewEnvScrubModule = ensureEnvScrubModule(request.sandboxRoot)
    // The sandbox wraps the shared Electron interpreter, not the standalone
    // node binary (which the desktop package no longer carries).
    const launcher: RuntimeLauncher | undefined =
      process.platform === 'darwin' && existsSync(sandbox)
        ? {
            args: ['-p', previewSandboxPolicy(request.sandboxRoot)],
            command: sandbox,
            env: desktopInterpreterSpawnEnv(paths, process.execPath),
            interpreter: true,
            interpreterCommand: process.execPath,
          }
        : desktopNodeLauncher(paths)
    return baseRuntimeOptions({
      cwd: workspaceRoot,
      env: {
        ...runtimeEnvironment(paths, {
          appDataPath: request.sandboxRoot,
          dshHome: request.dshHome,
          preview,
        }, 'marketplace'),
        TMPDIR: temporary,
      },
      // The require preload binds the interpreter variables to this launch; the
      // generated module lives inside the sandbox root, whose reads are allowed
      // by the preview policy.
      launcher,
      onLog: (stream, line) => { host.log(stream, `[preview:${request.pluginId}] ${line}`) },
      paths,
      readyTimeoutMs: 90_000,
      scrubModule: previewEnvScrubModule,
    })
  }

  return { previewRuntimeOptions, runtimeEnvironment, runtimeOptions }
}

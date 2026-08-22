import { join } from 'node:path'
import {
  findGitHubCli,
  withGitHubCredentials,
} from '../plugins/plugin-marketplace/src/host/platform.ts'
import {
  runtimeSearchPath,
  type BundledRuntimePaths,
} from './runtime-paths.ts'
import type { UserEnvironmentResolution } from './user-environment.ts'

export type RuntimeEnvironmentScope = 'user' | 'marketplace'

export interface DesktopRuntimeEnvironmentOptions {
  appDataPath: string
  dshHome: string
  extraEnvironment?: NodeJS.ProcessEnv
  githubCliPath?: string | null
  nodeEnvironment: NodeJS.ProcessEnv
  paths: BundledRuntimePaths
  preview?: { pluginId: string; transactionId: string }
  profile: string
  scope?: RuntimeEnvironmentScope
  userEnvironment: UserEnvironmentResolution
  version: string
}

function removeStaleMarketplaceConfig(
  environment: NodeJS.ProcessEnv,
  appDataPath: string,
): void {
  const marketplaceConfig = join(appDataPath, 'plugin-marketplace', 'gitconfig')
  if (environment.GIT_CONFIG_GLOBAL === marketplaceConfig) delete environment.GIT_CONFIG_GLOBAL
}

/** Build one Desktop child environment with an explicit trust/config scope. */
export function buildDesktopRuntimeEnvironment(
  options: DesktopRuntimeEnvironmentOptions,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...options.userEnvironment.env,
    ...options.nodeEnvironment,
    ...options.extraEnvironment,
    DSH_STUDIO_DESKTOP: '1',
    DSH_STUDIO_DESKTOP_APP_DATA: options.appDataPath,
    DSH_STUDIO_DESKTOP_PROFILE: options.profile,
    DSH_STUDIO_DESKTOP_VERSION: options.version,
    DSH_HOME: options.dshHome,
    DSH_STUDIO_HOME: options.dshHome,
    NODE_USE_ENV_PROXY: '1',
    PATH: runtimeSearchPath(
      options.paths,
      options.userEnvironment.env,
      undefined,
      options.scope === 'marketplace' ? 'bundled-first' : 'user-first',
    ),
  }
  if (options.preview !== undefined) {
    environment.DSH_STUDIO_PREVIEW = '1'
    environment.DSH_STUDIO_PREVIEW_PLUGIN = options.preview.pluginId
    environment.DSH_STUDIO_PREVIEW_TRANSACTION = options.preview.transactionId
  }
  if (options.scope !== 'marketplace') {
    removeStaleMarketplaceConfig(environment, options.appDataPath)
    return environment
  }
  const githubCliPath = options.githubCliPath === undefined
    ? findGitHubCli(environment)
    : options.githubCliPath
  return withGitHubCredentials(environment, githubCliPath)
}

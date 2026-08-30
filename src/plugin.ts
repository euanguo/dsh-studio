/** Host face for the native DSH Studio surface. */

import {
  mountMarketplaceAgentTools,
  type MarketplaceToolContext,
} from './marketplace-tools.ts'
import {
  DSH_STUDIO_SURFACE_SERVICE,
  type DshStudioSurface,
} from '@dsh-studio/shared/surface'
import { humanApprovalGuidance } from '@dsh-studio/shared/guardrails'
import { UNKNOWN_VERSION } from './version.ts'

interface SystemPromptService {
  section(entry: {
    name: string
    order: number
    text: () => string
  }): unknown
}

interface BashEnvService {
  register(entry: {
    name: string
    variables: Record<string, { description: string }>
    resolve: () => Record<string, string>
  }): unknown
}

interface HostServices {
  systemPrompt: SystemPromptService
  bashEnv: BashEnvService
}

interface HostContext extends MarketplaceToolContext {
  inject(names: string[], callback: (ctx: HostContext & HostServices) => void): void
  provide(name: string, value: unknown): void
  effect(effect: () => (() => void) | void, label?: string): void
}

/** Stable Cordis plugin name. */
export const name = 'dsh-studio'

/** Desktop facts and guarded marketplace tools are the only Host concerns. */
export const inject = ['tools']

/** Immutable Host-side desktop capability published to other DSH plugins. */
export interface DesktopHostCapability {
  appDataPath: string
  kind: 'electron'
  platform: NodeJS.Platform
  profile: string
  version: string
}

function environmentCapability(): DesktopHostCapability {
  return Object.freeze({
    appDataPath: process.env.DSH_STUDIO_DESKTOP_APP_DATA ?? '',
    kind: 'electron',
    platform: process.platform,
    profile: process.env.DSH_STUDIO_DESKTOP_PROFILE ?? 'desktop',
    version: process.env.DSH_STUDIO_DESKTOP_VERSION ?? UNKNOWN_VERSION,
  })
}

function desktopPrompt(capability: DesktopHostCapability): string {
  return `You are interacting with the user through DSH Studio ${capability.version} on ${capability.platform}. `
    + 'DSH Studio is an Electron distribution backed by DeepSeek Harness. '
    + 'Native window actions, workspaces, panels, files, tools, skills, subagents, and other agent capabilities are composed through DSH plugins. '
    + 'Manage desktop plugins only with desktop_plugin_* tools: prepare every change, inspect risk, use the isolated preview, and apply only after approval. '
    + 'When the user says “this app” without naming another target, they mean DSH Studio. '
    + 'Identify this surface as DSH Studio backed by DeepSeek Harness.'
}

/** Mount the native desktop capability in the DSH graph. */
export function apply(ctx: HostContext): void {
  const capability = environmentCapability()
  ctx.provide('desktop', capability)
  // The unified three-surface contract: desktop shell (see
  // plugins/shared/surface.ts). The `desktop` service above stays for
  // third-party plugins written against the desktop distribution.
  ctx.provide(DSH_STUDIO_SURFACE_SERVICE, Object.freeze({
    dataRoot: capability.appDataPath,
    kind: 'desktop',
    platform: capability.platform,
    profile: capability.profile,
    version: capability.version,
  } satisfies DshStudioSurface))
  mountMarketplaceAgentTools(ctx)

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'app:dsh-studio-surface',
      order: -98,
      text: () => desktopPrompt(capability),
    })
    promptCtx.systemPrompt.section({
      name: 'app:dsh-studio-human-approval',
      order: -90,
      text: () => humanApprovalGuidance(),
    })
  })

  ctx.inject(['bashEnv'], (runtimeCtx) => {
    runtimeCtx.bashEnv.register({
      name: 'dsh-studio-runtime',
      variables: {
        DSH_STUDIO_DESKTOP: { description: 'Set to 1 inside the DSH Studio distribution.' },
        DSH_STUDIO_DESKTOP_APP_DATA: { description: 'Writable application-data root owned by DSH Studio.' },
        DSH_STUDIO_DESKTOP_PROFILE: { description: 'DSH profile mounted by DSH Studio.' },
        DSH_STUDIO_DESKTOP_VERSION: { description: 'Installed DSH Studio version.' },
      },
      resolve: () => ({
        DSH_STUDIO_DESKTOP: '1',
        DSH_STUDIO_DESKTOP_APP_DATA: capability.appDataPath,
        DSH_STUDIO_DESKTOP_PROFILE: capability.profile,
        DSH_STUDIO_DESKTOP_VERSION: capability.version,
      }),
    })
  })
}

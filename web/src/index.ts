/** Host face for the DSH Studio Web browser distribution. */

import {
  DSH_STUDIO_SURFACE_SERVICE,
  type DshStudioSurface,
} from '@dsh-studio/shared/surface'
import { humanApprovalGuidance } from '@dsh-studio/shared/guardrails'

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

interface HostContext {
  inject(names: string[], callback: (ctx: HostContext & HostServices) => void): void
  provide(name: string, value: unknown): void
}

/** Stable Cordis plugin name. */
export const name = 'dsh-studio-web'

/**
 * Service name for the DSH Studio Web surface. The capability itself is the
 * shared `dshStudioSurface` contract (see plugins/shared/surface.ts). It is
 * deliberately NOT provided under the name `web`: the dsh-base layer already
 * provides the `web` search-provider registry (`@deepseek-ai/dsh-web`), and
 * shadowing it would break every row that injects it.
 */
export const WEB_SURFACE_SERVICE = DSH_STUDIO_SURFACE_SERVICE

function environmentSurface(): DshStudioSurface {
  return Object.freeze({
    dataRoot: process.env.DSH_STUDIO_WEB_DATA ?? '',
    kind: 'web',
    platform: process.platform,
    profile: process.env.DSH_STUDIO_WEB_PROFILE ?? 'web',
    version: process.env.DSH_STUDIO_WEB_VERSION ?? '0.0.0',
  })
}

function webPrompt(surface: DshStudioSurface): string {
  return `You are interacting with the user through DSH Studio Web ${surface.version} on ${surface.platform}. `
    + 'DSH Studio Web is a browser distribution backed by DeepSeek Harness. '
    + 'The web UI is served over HTTP and opened in a regular browser; workspaces, files, skills, subagents, and other agent capabilities are composed through DSH plugins. '
    + 'When the user says “this page” or “the web UI” without naming another target, they mean the DSH Studio Web interface. '
    + 'Identify this surface as DSH Studio Web backed by DeepSeek Harness.'
}

/** Mount the web distribution capability in the DSH graph. */
export function apply(ctx: HostContext): void {
  const surface = environmentSurface()
  // The unified three-surface contract: web shell (see
  // plugins/shared/surface.ts).
  ctx.provide(DSH_STUDIO_SURFACE_SERVICE, surface)

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'app:dsh-studio-web-surface',
      order: -98,
      text: () => webPrompt(surface),
    })
    promptCtx.systemPrompt.section({
      name: 'app:dsh-studio-human-approval',
      order: -90,
      text: () => humanApprovalGuidance(),
    })
  })

  ctx.inject(['bashEnv'], (runtimeCtx) => {
    runtimeCtx.bashEnv.register({
      name: 'dsh-studio-web-runtime',
      variables: {
        DSH_STUDIO_WEB: { description: 'Set to 1 inside the DSH Studio Web distribution.' },
        DSH_STUDIO_WEB_DATA: { description: 'Writable data root owned by DSH Studio Web.' },
        DSH_STUDIO_WEB_PROFILE: { description: 'DSH profile mounted by DSH Studio Web.' },
        DSH_STUDIO_WEB_VERSION: { description: 'Installed DSH Studio Web version.' },
      },
      resolve: () => ({
        DSH_STUDIO_WEB: '1',
        DSH_STUDIO_WEB_DATA: surface.dataRoot,
        DSH_STUDIO_WEB_PROFILE: surface.profile,
        DSH_STUDIO_WEB_VERSION: surface.version,
      }),
    })
  })
}

/** Host face for the Oh-DSH Web browser distribution. */

import {
  OH_DSH_SURFACE_SERVICE,
  type OhDshSurface,
} from '@oh-dsh/shared/surface'
import { humanApprovalGuidance } from '@oh-dsh/shared/guardrails'

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
export const name = 'oh-dsh-web'

/**
 * Service name for the Oh-DSH Web surface. The capability itself is the
 * shared `ohDshSurface` contract (see plugins/shared/surface.ts). It is
 * deliberately NOT provided under the name `web`: the dsh-base layer already
 * provides the `web` search-provider registry (`@deepseek-ai/dsh-web`), and
 * shadowing it would break every row that injects it.
 */
export const WEB_SURFACE_SERVICE = OH_DSH_SURFACE_SERVICE

function environmentSurface(): OhDshSurface {
  return Object.freeze({
    dataRoot: process.env.DSH_OH_WEB_DATA ?? '',
    kind: 'web',
    platform: process.platform,
    profile: process.env.DSH_OH_WEB_PROFILE ?? 'web',
    version: process.env.DSH_OH_WEB_VERSION ?? '0.0.0',
  })
}

function webPrompt(surface: OhDshSurface): string {
  return `You are interacting with the user through Oh-DSH Web ${surface.version} on ${surface.platform}. `
    + 'Oh-DSH Web is a browser distribution backed by DeepSeek Harness. '
    + 'The web UI is served over HTTP and opened in a regular browser; workspaces, files, skills, subagents, and other agent capabilities are composed through DSH plugins. '
    + 'When the user says “this page” or “the web UI” without naming another target, they mean the Oh-DSH Web interface. '
    + 'Identify this surface as Oh-DSH Web backed by DeepSeek Harness.'
}

/** Mount the web distribution capability in the DSH graph. */
export function apply(ctx: HostContext): void {
  const surface = environmentSurface()
  // The unified three-surface contract: web shell (see
  // plugins/shared/surface.ts).
  ctx.provide(OH_DSH_SURFACE_SERVICE, surface)

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'app:oh-dsh-web-surface',
      order: -98,
      text: () => webPrompt(surface),
    })
    promptCtx.systemPrompt.section({
      name: 'app:oh-dsh-human-approval',
      order: -90,
      text: () => humanApprovalGuidance(),
    })
  })

  ctx.inject(['bashEnv'], (runtimeCtx) => {
    runtimeCtx.bashEnv.register({
      name: 'oh-dsh-web-runtime',
      variables: {
        DSH_OH_WEB: { description: 'Set to 1 inside the Oh-DSH Web distribution.' },
        DSH_OH_WEB_DATA: { description: 'Writable data root owned by Oh-DSH Web.' },
        DSH_OH_WEB_PROFILE: { description: 'DSH profile mounted by Oh-DSH Web.' },
        DSH_OH_WEB_VERSION: { description: 'Installed Oh-DSH Web version.' },
      },
      resolve: () => ({
        DSH_OH_WEB: '1',
        DSH_OH_WEB_DATA: surface.dataRoot,
        DSH_OH_WEB_PROFILE: surface.profile,
        DSH_OH_WEB_VERSION: surface.version,
      }),
    })
  })
}

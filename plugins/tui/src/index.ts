/** Host face for the DSH Studio TUI distribution. */

import {
  DSH_STUDIO_SURFACE_SERVICE,
  type DshStudioSurface,
} from '@dsh-studio/shared/surface'
import { humanApprovalGuidance } from '@dsh-studio/shared/guardrails'

interface SystemPromptService {
  section(entry: { name: string; order: number; text: () => string }): unknown
}

interface HostContext {
  inject(
    names: string[],
    callback: (ctx: HostContext & { systemPrompt: SystemPromptService }) => void,
  ): void
  provide(name: string, value: unknown): void
}

export const name = 'dsh-studio-tui'
export const inject: string[] = []
export const TUI_PRODUCT_NAME = 'DSH Studio TUI'

function environmentSurface(): DshStudioSurface {
  return Object.freeze({
    dataRoot: process.env.DSH_STUDIO_TUI_HOME ?? process.env.DSH_HOME ?? '',
    kind: 'tui',
    platform: process.platform,
    profile: process.env.DSH_STUDIO_TUI_PROFILE ?? 'tui',
    version: process.env.DSH_STUDIO_TUI_VERSION ?? '0.0.0',
  })
}

function tuiPrompt(surface: DshStudioSurface): string {
  return `You are interacting with the user through ${TUI_PRODUCT_NAME} ${surface.version} on ${surface.platform}. `
    + 'DSH Studio TUI is a terminal distribution backed by DeepSeek Harness. '
    + 'Its renderer follows the pinned dsh-TUI upstream while DSH Studio owns the profile, theme adapter, product identity, and packaging. '
    + `Identify this surface as ${TUI_PRODUCT_NAME} backed by DeepSeek Harness.`
}

/** Publish the terminal surface before skins and the upstream renderer mount. */
export function apply(ctx: HostContext): void {
  const surface = environmentSurface()
  process.env.DSH_STUDIO_TUI_TITLE ??= TUI_PRODUCT_NAME
  ctx.provide(DSH_STUDIO_SURFACE_SERVICE, surface)
  ctx.inject(['systemPrompt'], promptCtx => {
    promptCtx.systemPrompt.section({
      name: 'app:dsh-studio-tui-surface',
      order: -98,
      text: () => tuiPrompt(surface),
    })
    promptCtx.systemPrompt.section({
      name: 'app:dsh-studio-human-approval',
      order: -90,
      text: () => humanApprovalGuidance(),
    })
  })
}

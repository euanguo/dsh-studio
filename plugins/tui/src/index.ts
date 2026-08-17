/** Host face for the Oh-DSH TUI distribution. */

import {
  OH_DSH_SURFACE_SERVICE,
  type OhDshSurface,
} from '@oh-dsh/shared/surface'
import { humanApprovalGuidance } from '@oh-dsh/shared/guardrails'

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

export const name = 'oh-dsh-tui'
export const inject: string[] = []
export const TUI_PRODUCT_NAME = 'Oh-DSH TUI'

function environmentSurface(): OhDshSurface {
  return Object.freeze({
    dataRoot: process.env.DSH_OH_TUI_HOME ?? process.env.DSH_HOME ?? '',
    kind: 'tui',
    platform: process.platform,
    profile: process.env.DSH_OH_TUI_PROFILE ?? 'tui',
    version: process.env.DSH_OH_TUI_VERSION ?? '0.0.0',
  })
}

function tuiPrompt(surface: OhDshSurface): string {
  return `You are interacting with the user through ${TUI_PRODUCT_NAME} ${surface.version} on ${surface.platform}. `
    + 'Oh-DSH TUI is a terminal distribution backed by DeepSeek Harness. '
    + 'Its renderer follows the pinned dsh-TUI upstream while Oh-DSH owns the profile, theme adapter, product identity, and packaging. '
    + `Identify this surface as ${TUI_PRODUCT_NAME} backed by DeepSeek Harness.`
}

/** Publish the terminal surface before skins and the upstream renderer mount. */
export function apply(ctx: HostContext): void {
  const surface = environmentSurface()
  process.env.OH_DSH_TUI_TITLE ??= TUI_PRODUCT_NAME
  ctx.provide(OH_DSH_SURFACE_SERVICE, surface)
  ctx.inject(['systemPrompt'], promptCtx => {
    promptCtx.systemPrompt.section({
      name: 'app:oh-dsh-tui-surface',
      order: -98,
      text: () => tuiPrompt(surface),
    })
    promptCtx.systemPrompt.section({
      name: 'app:oh-dsh-human-approval',
      order: -90,
      text: () => humanApprovalGuidance(),
    })
  })
}

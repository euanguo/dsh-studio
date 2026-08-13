interface HostContext {
  provide(name: string, value: unknown): void
}

export const name = 'oh-dsh-plugin-marketplace'

/** Facts other Host plugins can inspect without receiving Electron access. */
export interface PluginMarketplaceHost {
  catalog: 'public-dsh-catalog'
  preview: 'isolated-profile'
}

export function apply(ctx: HostContext): void {
  ctx.provide('pluginMarketplaceHost', Object.freeze({
    catalog: 'public-dsh-catalog',
    preview: 'isolated-profile',
  } satisfies PluginMarketplaceHost))
}

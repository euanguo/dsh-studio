/**
 * Desktop panel services (bundle: @dsh-studio/panel-controls).
 *
 * The terminal bottom dock was removed by user preference and the old
 * right-panel claim coordinator (app-root squeeze writer + ownership flag)
 * is gone: right-panel footprints negotiate exclusively through the
 * workbench LayoutService (`claim/release/preview` over
 * `ctx.get('workbench.layout')` + `@dsh-studio/shared/layout-dom`). What
 * remains here is the DesktopPanels bridge the native menu's toggle-sidebar
 * command dispatches through. The native menu binder owning the old dock
 * toggle was removed.
 */
import type { LocaleService } from '@dsh-studio/shared/i18n'
import { TERMINAL_MESSAGES } from './i18n.ts'

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

/** The panel-control face consumed by the desktop shell command dispatcher. */
export interface DesktopPanels {
  /** Native-menu "Toggle Sidebar" command → the sidebar layout service. */
  toggleSidebar(): void
}

export const inject = ['layout', 'locale']

interface LayoutService {
  toggleSidebar(): void
}

class DesktopPanelService implements DesktopPanels {
  private readonly layout: LayoutService

  constructor(layout: LayoutService) {
    this.layout = layout
  }

  toggleSidebar(): void {
    this.layout.toggleSidebar()
  }
}

export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  ctx.effect(
    () => locale.register('dsh-studio.terminal', TERMINAL_MESSAGES),
    'dsh-studio: terminal dictionaries',
  )
  const service = new DesktopPanelService(
    ctx.get('layout') as LayoutService,
  )
  ctx.effect(() => {
    const removeService = ctx.reflect.provide('desktopPanels', service, undefined)
    return () => {
      void removeService?.()
    }
  }, 'dsh-studio: terminal panel controls')
}

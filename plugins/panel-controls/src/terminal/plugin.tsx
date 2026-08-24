/**
 * Desktop panel services (bundle: @dsh-studio/panel-controls).
 *
 * The terminal bottom dock was removed by user preference; this plugin keeps
 * its public surface — the right-panel claim coordinator + the DesktopPanels
 * API — so the sidebar and other plugins keep compiling and the layout
 * squeeze stays intact. The dock-only methods (setAutoOpenTerminal,
 * setTerminalFontPreferences, toggleBottomPanel, isBottomPanelOpen) are
 * deliberate no-ops.
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

/**
 * One right-panel owner's footprint claim. Only the most recently claimed
 * owner applies: the coordinator owns `data-dsh-studio-right-panel-owner` and
 * the `#root` squeeze, so plugins no longer race over global state.
 */
export interface RightPanelClaim {
  /**
   * CSS padding-right applied to #root while this claim is active, or null
   * when the owner only wants the flag (no squeeze). `box-sizing: border-box`
   * is applied together with a non-null squeeze and removed on release.
   */
  paddingRight: string | null
}

export interface DesktopPanels {
  claimRightPanel(ownerId: string, claim: RightPanelClaim): void
  isBottomPanelOpen(): boolean
  /**
   * Live drag preview of the right panel's `#root` squeeze. Writes the real
   * padding-right so the center column follows a width drag frame-by-frame,
   * WITHOUT touching the claim registry / owner attribution — the pointermove
   * hot path must not mutate coordinator state. The owner re-asserts its
   * claim on pointerup via `claimRightPanel`.
   */
  previewRightPanel(paddingRight: string): void
  releaseRightPanel(ownerId: string): void
  setAutoOpenTerminal(enabled: boolean): void
  /** Apply the GLOBAL terminal font preferences. CUT: dock no longer mounts — no-op. */
  setTerminalFontPreferences(family: string, size: number): void
  subscribe(listener: () => void): () => void
  toggleBottomPanel(): void
  toggleSidebar(): void
}

export const inject = ['layout', 'locale', 'sessions']

interface LayoutService {
  toggleSidebar(): void
}

class DesktopPanelService implements DesktopPanels {
  private readonly listeners = new Set<() => void>()
  private readonly layout: LayoutService
  private readonly rightPanelClaims = new Map<string, RightPanelClaim>()
  private readonly rightPanelOrder: string[] = []

  constructor(layout: LayoutService) {
    this.layout = layout
  }

  /** CUT: the terminal dock no longer mounts; nothing to set up. */
  mount(): void {}

  dispose(): void {
    // Right-panel claims are released by their owners.
  }

  /** CUT: the bottom panel no longer exists — always closed. */
  isBottomPanelOpen(): boolean {
    return false
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Claim the right panel footprint for one owner. The most recently claimed
   * owner wins; earlier claims stay registered so their release can never
   * clear another owner's squeeze. Opening one panel while another is open is
   * mutual-excluded by the callers, so a single active owner is the norm.
   */
  claimRightPanel(ownerId: string, claim: RightPanelClaim): void {
    this.rightPanelClaims.set(ownerId, claim)
    const index = this.rightPanelOrder.indexOf(ownerId)
    if (index !== -1) this.rightPanelOrder.splice(index, 1)
    this.rightPanelOrder.push(ownerId)
    this.applyRightPanel()
  }

  /** Drop an owner's claim; releases the squeeze when it was the active one. */
  releaseRightPanel(ownerId: string): void {
    this.rightPanelClaims.delete(ownerId)
    const index = this.rightPanelOrder.indexOf(ownerId)
    if (index !== -1) this.rightPanelOrder.splice(index, 1)
    this.applyRightPanel()
  }

  /**
   * Live drag preview of the `#root` squeeze (see the interface doc). Kept
   * dirty-checked so repeated identical pointers stay no-ops.
   */
  previewRightPanel(paddingRight: string): void {
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    if (appRoot.style.boxSizing !== 'border-box') {
      appRoot.style.setProperty('box-sizing', 'border-box')
    }
    if (appRoot.style.paddingRight !== paddingRight) {
      appRoot.style.setProperty('padding-right', paddingRight)
    }
  }

  private applyRightPanel(): void {
    const html = document.documentElement
    const ownerId = this.rightPanelOrder[this.rightPanelOrder.length - 1]
    const claim = ownerId === undefined ? undefined : this.rightPanelClaims.get(ownerId)
    const appRoot = document.getElementById('root')
    if (claim !== undefined && ownerId !== undefined) {
      if (html.dataset.dshStudioRightPanelOwner !== ownerId) {
        html.dataset.dshStudioRightPanelOwner = ownerId
      }
      if (claim.paddingRight === null) {
        appRoot?.style.removeProperty('padding-right')
        appRoot?.style.removeProperty('box-sizing')
      } else {
        // Dirty-checked: the sidebar's drag preview may have already written
        // the same value, and a no-op write still cascades reflow/observers.
        if (appRoot?.style.boxSizing !== 'border-box') {
          appRoot?.style.setProperty('box-sizing', 'border-box')
        }
        if (appRoot?.style.paddingRight !== claim.paddingRight) {
          appRoot?.style.setProperty('padding-right', claim.paddingRight)
        }
      }
    } else {
      delete html.dataset.dshStudioRightPanelOwner
      appRoot?.style.removeProperty('padding-right')
      appRoot?.style.removeProperty('box-sizing')
    }
  }

  /** CUT: the terminal dock no longer mounts — no-op. */
  setAutoOpenTerminal(): void {}

  /** CUT: the terminal dock no longer mounts — no-op. */
  setTerminalFontPreferences(): void {}

  /** CUT: the bottom panel no longer exists — no-op. */
  toggleBottomPanel(): void {}

  toggleSidebar(): void {
    this.layout.toggleSidebar()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
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
    service.mount()
    const removeService = ctx.reflect.provide('desktopPanels', service, undefined)
    return () => {
      service.dispose()
      void removeService?.()
    }
  }, 'dsh-studio: terminal panel controls')
}
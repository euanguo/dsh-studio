/**
 * Desktop panel services (bundle: @oh-dsh/panel-controls).
 *
 * OH-DSH CUT (user preference): the terminal bottom dock is no longer
 * mounted under the conversation column. The bottom-mounted terminal
 * machinery below is commented out in place ("注释短路") — the service keeps
 * its public surface (the right-panel claim coordinator + the DesktopPanels
 * API) so the sidebar and other plugins keep compiling and the layout
 * squeeze stays intact, but at runtime it creates no dock root, no session
 * surfaces, no MutationObserver and no React subtree. The terminal toggle
 * button, the terminal menu entry and the bottom workbench were removed
 * alongside (see SideToolsPanel.tsx / builtins/tabs.tsx / workspace-tools.tsx).
 * Restore by uncommenting the marked blocks below and re-adding the imports.
 */
import type { LocaleService } from '@oh-dsh/shared/i18n'
import { TERMINAL_MESSAGES } from './i18n.ts'

// CUT (terminal dock): imports only used by the bottom-mounted dock.
// import { Fragment } from 'react'
// import { createRoot, type Root } from 'react-dom/client'
// import xtermCss from '@xterm/xterm/css/xterm.css'
// import terminalCss from './terminal.css'
// import themeCss from '@oh-dsh/shared/theme.css'
// import { ensureStyle } from '@oh-dsh/shared/style-injector'
// import { TerminalPanel, openOrToggleTerminal } from './TerminalPanel.tsx'
// import {
//   createMountScheduler,
//   findConversationColumn,
//   mutationNeedsMount,
// } from '@oh-dsh/shared/column-mount'
// import {
//   DEFAULT_TERMINAL_FONT_SIZE,
//   createDockStore,
//   hasPersistedDockState,
//   terminalFontPrefActions,
//   type DockStore,
// } from './panel-store.ts'

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

// CUT (terminal dock): per-session surface plumbing.
// interface SessionSurface {
//   scopeKey: string
//   cwd: string | null
//   store: DockStore
// }
//
// interface ReactMount {
//   element: HTMLDivElement | null
//   root: Root | null
// }

/**
 * One right-panel owner's footprint claim. Only the most recently claimed
 * owner applies: the coordinator owns `data-oh-dsh-right-panel-owner` and
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
  /**
   * Apply the GLOBAL terminal font preferences (from the sidebar settings
   * page): an empty family keeps the dock's own font, a size within the
   * 9–32 range applies live to the active dock; brand-new docks (no
   * persisted per-session font) are seeded with them. Existing docks keep
   * their per-session font until the user changes one of these prefs.
   *
   * CUT: the terminal dock no longer mounts, so this is a no-op.
   */
  setTerminalFontPreferences(family: string, size: number): void
  subscribe(listener: () => void): () => void
  toggleBottomPanel(): void
  toggleSidebar(): void
}

export const inject = ['layout', 'locale', 'sessions']

class DesktopPanelService implements DesktopPanels {
  private readonly listeners = new Set<() => void>()
  private readonly layout: LayoutService
  private readonly rightPanelClaims = new Map<string, RightPanelClaim>()
  private readonly rightPanelOrder: string[] = []
  // CUT (terminal dock): dock lifecycle state.
  // private readonly sessions: SessionsService
  // private readonly surfaces = new Map<string, SessionSurface>()
  // private active: SessionSurface | undefined
  // private readonly dock: ReactMount = { element: null, root: null }
  // private stopStyle: (() => void) | undefined
  // private observer: MutationObserver | undefined
  // private stopSessionSubscription: (() => void) | undefined
  // private stopActiveStoreSubscription: (() => void) | undefined
  // private scheduler: ReturnType<typeof createMountScheduler> | undefined
  // private autoOpenTerminal = true
  // private terminalFontFamily = ''
  // private terminalFontSize = DEFAULT_TERMINAL_FONT_SIZE
  // private fontsInitialized = false

  constructor(layout: LayoutService) {
    this.layout = layout
  }

  /** CUT: the terminal dock no longer mounts; nothing to set up. */
  mount(): void {}

  dispose(): void {
    // CUT: terminal cleanup (dock root / observer / session subscriptions)
    // removed with the dock. Right-panel claims are released by their owners.
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
      if (html.dataset.ohDshRightPanelOwner !== ownerId) {
        html.dataset.ohDshRightPanelOwner = ownerId
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
      delete html.dataset.ohDshRightPanelOwner
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

  // CUT (terminal dock): the following were the bottom-mounted dock's
  // lifecycle — session sync, surface creation, dock mounting and rendering.
  // Restore together with the imports at the top of this file.
  //
  // private applyTerminalFontTo(store: DockStore): void {
  //   for (const action of terminalFontPrefActions(this.terminalFontFamily, this.terminalFontSize)) {
  //     store.dispatch(action)
  //   }
  // }
  //
  // private surfaceFor(scopeKey: string, cwd: string | null): SessionSurface {
  //   ...createDockStore + font seeding...
  // }
  //
  // private syncActiveSession(): void {
  //   ...surfaceFor + store subscription + renderDock()...
  // }
  //
  // private mountAll(): void {
  //   const column = findConversationColumn()
  //   if (column === null) return
  //   this.mountDock(column)
  // }
  //
  // private mountDock(column: HTMLElement): void {
  //   ...create #oh-dsh-terminal-root, append as last child, renderDock()...
  // }
  //
  // private renderDock(): void {
  //   ...TerminalPanel per active session...
  // }
}

export function apply(ctx: ClientContext): void {
  const locale = ctx.get('locale') as LocaleService
  ctx.effect(
    () => locale.register('oh-dsh.terminal', TERMINAL_MESSAGES),
    'oh-dsh-desktop: terminal dictionaries',
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
  }, 'oh-dsh-desktop: terminal panel controls')
}

/** CUT (terminal dock): session model used by the dock's per-session sync. */
interface LayoutService {
  toggleSidebar(): void
}
/**
 * marketplace-view.tsx (leaf-4.2)
 * ---------------------------------------------------------------------
 * The marketplace view controller: owns the plugin's DOM mount point, its
 * open/available state, the upstream-DOM monitor (via marketplace-dom.ts) and
 * the sessions-sync that closes the modal on session navigation. Also hosts
 * the thin surface root (C34 key remount) and the footer navigation entry.
 * Kept apart from plugin.tsx so the surface shell's `apply()` wiring stays
 * readable; probes and data/command logic live in their own modules.
 */
import { useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { DesktopBridge } from '@dsh-studio/shared/desktop-contracts'
import { ensureStyle } from '@dsh-studio/shared/style-injector'
import type { LocaleService, Translate } from '@dsh-studio/shared/i18n'
import { useTranslate } from '@dsh-studio/shared/use-i18n'
import { IconApps } from '@dsh-studio/shared/tabler-icons'
import { loadUiChromeFlags, setUiChromeFlag } from '@dsh-studio/shared/ui-chrome-flags'
import type { MarketplaceMessage } from './i18n.ts'
import { pluginCss } from './styles.js'
import type { MarketplaceStore } from './store.ts'
import { MarketplaceModal } from './marketplace-filters.tsx'
import { useMarketplaceData } from './use-marketplace.ts'
import {
  applyFooterStackMarker,
  marketplaceFooterStack,
  observeMarketplaceDom,
  settingsButton,
  settingsDialogOpen,
  type DomObserverHandle,
} from './marketplace-dom.ts'
import {
  initialSessionNavigationState,
  transitionSessionNavigation,
  type SessionNavigationState,
} from './session-navigation.ts'

export interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

export interface MarketplaceViewState {
  available: boolean
  open: boolean
}

interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface SessionsService {
  list: ObservableSnapshot<{ current: string | undefined; phase: 'pending' | 'ready' }>
}

export interface SlotsService {
  inject(name: string, register: () => unknown): void
  register(options: {
    id: string
    inject(): { locale: LocaleService; t: Translate<MarketplaceMessage>; view: PluginMarketplaceView }
    locale: string
    name: string
    order: number
  }, component: (props: MarketplaceNavigationProps) => JSX.Element | null): unknown
}

export interface PluginMarketplaceView {
  getSnapshot(): MarketplaceViewState
  setOpen(open: boolean): void
  subscribe(listener: () => void): () => void
  toggle(): void
}

export interface MarketplaceNavigationProps {
  locale: LocaleService
  t: Translate<MarketplaceMessage>
  view: PluginMarketplaceView
  wide: boolean
}

declare global {
  interface Window {
    dshDesktop?: DesktopBridge
  }
}

export function MarketplaceNavigationEntry({
  t,
  view,
  wide,
}: MarketplaceNavigationProps): JSX.Element | null {
  const state = useSyncExternalStore(view.subscribe, view.getSnapshot)
  const label = t('plugins')
  if (!state.available) return null
  return (
    <button
      aria-label={label}
      className="oh-marketplace-nav"
      data-active={String(state.open)}
      data-collapsed={String(!wide)}
      onClick={() => { view.toggle() }}
      type="button"
    >
      <IconApps size={16} />
      {wide && <span>{label}</span>}
    </button>
  )
}

function MarketplaceSurface({ bridge, locale, translate, view, store }: {
  bridge: DesktopBridge
  locale: LocaleService
  translate: Translate<MarketplaceMessage>
  view: PluginMarketplaceViewService
  store: MarketplaceStore
}): JSX.Element {
  const t = useTranslate(locale, translate)
  const open = useSyncExternalStore(view.subscribe, () => view.getSnapshot().open)
  const { data, run } = useMarketplaceData(bridge, store)
  // C34(resolved): no reset machinery at all — filter selections persist
  // across close/open by design; the old effect-based reset (and the
  // harmful whole-tree remount key) are gone.
  return (
    <MarketplaceModal
      t={t}
      locale={locale}
      open={open}
      onClose={() => { view.setOpen(false) }}
      bridge={bridge}
      data={data}
      run={run}
    />
  )
}

export class PluginMarketplaceViewService implements PluginMarketplaceView {
  readonly #bridge: DesktopBridge
  readonly #locale: LocaleService
  readonly #t: Translate<MarketplaceMessage>
  readonly #sessions: SessionsService
  readonly #listeners = new Set<() => void>()
  #state: MarketplaceViewState = { available: false, open: false }
  #element: HTMLDivElement | null = null
  #stopStyle: (() => void) | null = null
  #root: Root | null = null
  #observer: DomObserverHandle | null = null
  #geometryFrame: number | null = null
  #footerStack: HTMLElement | null = null
  #unsubscribeSessions: (() => void) | null = null
  #sessionNavigationState: SessionNavigationState = initialSessionNavigationState()
  #store: MarketplaceStore

  constructor(
    bridge: DesktopBridge,
    locale: LocaleService,
    t: Translate<MarketplaceMessage>,
    sessions: SessionsService,
    store: MarketplaceStore,
  ) {
    this.#bridge = bridge
    this.#locale = locale
    this.#t = t
    this.#sessions = sessions
    this.#store = store
  }

  getSnapshot = (): MarketplaceViewState => this.#state

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  async hydrate(): Promise<void> {
    const flags = await loadUiChromeFlags()
    if (this.#state.open === flags.pluginMarketplaceOpen) return
    this.#state = { ...this.#state, open: flags.pluginMarketplaceOpen }
    this.#notify()
  }

  setOpen(open: boolean): void {
    if (this.#state.open === open) return
    this.#state = { ...this.#state, open }
    setUiChromeFlag('pluginMarketplaceOpen', open)
    this.#notify()
  }

  toggle(): void { this.setOpen(!this.#state.open) }

  mount(): void {
    this.#sessionNavigationState = initialSessionNavigationState()
    /* scrollable.css is injected once by the sidebar's workspace-tools chain;
       re-injecting it here duplicated every rule. Only marketplace styles. */
    this.#stopStyle = ensureStyle('dsh-studio-plugin-marketplace', pluginCss)

    this.#element = document.createElement('div')
    this.#element.id = 'dsh-studio-plugin-marketplace-root'
    document.body.append(this.#element)
    this.#root = createRoot(this.#element)
    this.#root.render(
      <MarketplaceSurface
        bridge={this.#bridge}
        locale={this.#locale}
        translate={this.#t}
        view={this}
        store={this.#store}
      />,
    )

    this.#state = { ...this.#state, available: true }
    this.#notify()

    // C39: DOM probing lives in marketplace-dom; the observer is body-scoped
    // (needed to see portaled settings dialogs) but coalesces to one eval per
    // frame, and the costly dialog scan here is gated on the open flag.
    this.#observer = observeMarketplaceDom(() => {
      if (this.#state.open && settingsDialogOpen()) this.setOpen(false)
      this.scheduleGeometry()
    })
    document.addEventListener('click', this.#handleDocumentClick, true)
    const syncSessionNavigation = (): void => {
      const transition = transitionSessionNavigation(
        this.#sessionNavigationState,
        this.#sessions.list.getSnapshot(),
      )
      this.#sessionNavigationState = transition.state
      if (transition.close) this.setOpen(false)
    }
    this.#unsubscribeSessions = this.#sessions.list.subscribe(syncSessionNavigation)
    syncSessionNavigation()
    this.scheduleGeometry()
  }

  dispose(): void {
    document.removeEventListener('click', this.#handleDocumentClick, true)
    this.#unsubscribeSessions?.()
    this.#unsubscribeSessions = null
    if (this.#geometryFrame !== null) cancelAnimationFrame(this.#geometryFrame)
    this.#observer?.disconnect()
    this.#observer = null
    this.#root?.unmount()
    this.#footerStack = null
    this.#element?.remove()
    this.#stopStyle?.()
    this.#stopStyle = null
    this.#state = { available: false, open: false }
    this.#notify()
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }

  readonly #handleDocumentClick = (event: MouseEvent): void => {
    if (!this.#state.open || !(event.target instanceof Element)) return
    const button = event.target.closest('button')
    if (button !== null && button === settingsButton()) this.setOpen(false)
  }

  private scheduleGeometry(): void {
    if (this.#geometryFrame !== null) return
    this.#geometryFrame = requestAnimationFrame(() => {
      this.#geometryFrame = null
      const settings = settingsButton()
      const footerStack = settings === null ? null : marketplaceFooterStack(settings)
      this.#footerStack = applyFooterStackMarker(footerStack, this.#footerStack)
    })
  }
}
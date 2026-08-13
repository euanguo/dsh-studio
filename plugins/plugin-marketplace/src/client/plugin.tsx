import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { DesktopBridge } from '../../../../src/contracts.ts'
import type { LocaleService, Translate } from '../../../shared/i18n.ts'
import { localeTag } from '../../../shared/i18n.ts'
import { useTranslate } from '../../../shared/use-i18n.ts'
import themeCss from '../../../shared/theme.css'
import type {
  MarketplaceCommand,
  MarketplaceConfirmation,
  MarketplacePlugin,
  MarketplaceRiskReason,
  MarketplaceSnapshot,
} from '../protocol.ts'
import { MARKETPLACE_MESSAGES, type MarketplaceMessage } from './i18n.ts'
import marketplaceCss from './marketplace.css'
import {
  initialSessionNavigationState,
  transitionSessionNavigation,
  type SessionListSnapshot,
  type SessionNavigationState,
} from './session-navigation.ts'

interface ClientContext {
  effect(effect: () => (() => void) | void, label?: string): void
  get(name: string): unknown
  reflect: {
    provide(name: string, value: unknown, options?: unknown): (() => Promise<void> | void) | void
  }
}

interface MarketplaceViewState {
  open: boolean
}

interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface SessionsService {
  list: ObservableSnapshot<SessionListSnapshot>
}

export interface PluginMarketplaceView {
  isOpen(): boolean
  setOpen(open: boolean): void
  subscribe(listener: () => void): () => void
  toggle(): void
}

declare global {
  interface Window {
    dshDesktop?: DesktopBridge
  }
}

export const inject = ['locale', 'sessions']

const OPEN_KEY = 'oh-dsh-desktop.plugin-marketplace.open'

function readOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) === 'true' } catch { return false }
}

function persistOpen(open: boolean): void {
  try { localStorage.setItem(OPEN_KEY, String(open)) } catch { /* best effort */ }
}

function settingsButton(): HTMLButtonElement | null {
  // Primary: the DSH Settings button is the sidebar foot's dialog trigger.
  // In the collapsed rail it carries NO text/aria-label, so locate it
  // structurally (inside the sidebar slot) instead of by label.
  const inSidebar = [...document.querySelectorAll<HTMLButtonElement>(
    '[data-slot="sidebar"] button[aria-haspopup="dialog"]',
  )]
    .filter(button => button.closest('#oh-dsh-plugin-marketplace-root') === null)
    .sort((left, right) => {
      return right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom
    })
  if (inSidebar.length > 0) return inSidebar[0] ?? null
  // Fallback: label-based scan (older DOM shapes / non-sidebar hosts).
  const candidates = [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')]
    .filter(button => {
      if (button.closest('#oh-dsh-plugin-marketplace-root') !== null) return false
      const label = [
        button.textContent,
        button.getAttribute('aria-label'),
        button.getAttribute('title'),
      ].filter(Boolean).join(' ').trim().toLowerCase()
      const rect = button.getBoundingClientRect()
      return (label.includes('settings') || label.includes('设置'))
        && rect.width > 0 && rect.height > 0
    })
  return candidates.sort((left, right) => {
    return right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom
  })[0] ?? null
}

function settingsDialogOpen(): boolean {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
    .some(dialog => {
      const labelledBy = dialog.getAttribute('aria-labelledby')
      const label = [
        dialog.getAttribute('aria-label'),
        labelledBy === null ? null : document.getElementById(labelledBy)?.textContent,
        dialog.textContent?.slice(0, 80),
      ].filter(Boolean).join(' ').trim().toLowerCase()
      return label.includes('settings') || label.includes('设置')
    })
}

function sidebarFor(settings: HTMLElement): HTMLElement | null {
  const declared = document.querySelector<HTMLElement>('[data-slot="sidebar"]')
  if (declared !== null) return declared
  const aside = settings.closest<HTMLElement>('aside')
  if (aside !== null) return aside
  let candidate: HTMLElement | null = settings.parentElement
  let best: HTMLElement | null = candidate
  while (candidate !== null && candidate !== document.body) {
    const rect = candidate.getBoundingClientRect()
    if (rect.left <= 8 && rect.height > window.innerHeight * 0.55 && rect.width < window.innerWidth * 0.5) {
      best = candidate
    }
    candidate = candidate.parentElement
  }
  return best
}

function pluginIcon(label: string): string {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.2 5.3a7.5 7.5 0 1 0 9.9 2.1" />
      <path d="M15.7 3.4v4.8h4.8" />
      <circle cx="10" cy="11" r="1.7" />
      <path d="M11.5 12.2l2.8 2.3M7.8 15.8l2.3-2.9" />
    </svg>
    <span>${label}</span>
  `
}

class PluginMarketplaceViewService implements PluginMarketplaceView {
  readonly #bridge: DesktopBridge
  readonly #locale: LocaleService
  readonly #t: Translate<MarketplaceMessage>
  readonly #sessions: SessionsService
  readonly #listeners = new Set<() => void>()
  #state: MarketplaceViewState = { open: readOpen() }
  #element: HTMLDivElement | null = null
  #style: HTMLStyleElement | null = null
  #root: Root | null = null
  #entry: HTMLButtonElement | null = null
  /** Cached DSH Settings button: in the collapsed rail it carries no text or
   *  aria-label, so the locator returns null — the cache keeps class/position
   *  sync alive across rail expand/collapse cycles. */
  #settingsButton: HTMLButtonElement | null = null
  #observer: MutationObserver | null = null
  #resizeObserver: ResizeObserver | null = null
  #placementFrame: number | null = null
  #unsubscribeLocale: (() => void) | null = null
  #unsubscribeSessions: (() => void) | null = null
  #sessionNavigationState: SessionNavigationState = initialSessionNavigationState()
  readonly #handleResize = (): void => { this.schedulePlacement() }
  readonly #handleDocumentClick = (event: MouseEvent): void => {
    if (!this.#state.open || !(event.target instanceof Element)) return
    const button = event.target.closest('button')
    if (button !== null && button === settingsButton()) this.setOpen(false)
  }

  constructor(
    bridge: DesktopBridge,
    locale: LocaleService,
    t: Translate<MarketplaceMessage>,
    sessions: SessionsService,
  ) {
    this.#bridge = bridge
    this.#locale = locale
    this.#t = t
    this.#sessions = sessions
  }

  getSnapshot = (): MarketplaceViewState => this.#state

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  isOpen(): boolean { return this.#state.open }

  setOpen(open: boolean): void {
    if (this.#state.open === open) return
    this.#state = { open }
    persistOpen(open)
    this.applyOpenState()
    for (const listener of this.#listeners) listener()
  }

  toggle(): void { this.setOpen(!this.#state.open) }

  mount(): void {
    this.#sessionNavigationState = initialSessionNavigationState()
    this.#style = document.createElement('style')
    this.#style.dataset.ohDshPluginMarketplaceStyles = 'true'
    this.#style.textContent = `${themeCss}\n${marketplaceCss}`
    document.head.append(this.#style)

    this.#element = document.createElement('div')
    this.#element.id = 'oh-dsh-plugin-marketplace-root'
    document.body.append(this.#element)
    this.#root = createRoot(this.#element)
    this.#root.render(
      <MarketplaceSurface
        bridge={this.#bridge}
        locale={this.#locale}
        translate={this.#t}
        view={this}
      />,
    )

    this.#observer = new MutationObserver(() => {
      if (this.#state.open && settingsDialogOpen()) this.setOpen(false)
      this.schedulePlacement()
    })
    this.#observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    this.#resizeObserver = new ResizeObserver(() => { this.schedulePlacement() })
    document.addEventListener('click', this.#handleDocumentClick, true)
    window.addEventListener('resize', this.#handleResize)
    this.#unsubscribeLocale = this.#locale.subscribe(() => {
      this.renderEntryLabel()
    })
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
    this.applyOpenState()
    this.schedulePlacement()
  }

  dispose(): void {
    document.removeEventListener('click', this.#handleDocumentClick, true)
    window.removeEventListener('resize', this.#handleResize)
    this.#unsubscribeLocale?.()
    this.#unsubscribeLocale = null
    this.#unsubscribeSessions?.()
    this.#unsubscribeSessions = null
    if (this.#placementFrame !== null) cancelAnimationFrame(this.#placementFrame)
    this.#observer?.disconnect()
    this.#resizeObserver?.disconnect()
    this.#entry?.remove()
    this.#root?.unmount()
    this.#element?.remove()
    this.#style?.remove()
    delete document.documentElement.dataset.ohDshMarketplaceOpen
    document.documentElement.style.removeProperty('--oh-marketplace-left')
  }

  private applyOpenState(): void {
    if (this.#state.open) document.documentElement.dataset.ohDshMarketplaceOpen = 'true'
    else delete document.documentElement.dataset.ohDshMarketplaceOpen
    if (this.#entry !== null) this.#entry.dataset.active = String(this.#state.open)
  }

  private schedulePlacement(): void {
    if (this.#placementFrame !== null) return
    this.#placementFrame = requestAnimationFrame(() => {
      this.#placementFrame = null
      this.placeEntry()
    })
  }

  private placeEntry(): void {
    const found = settingsButton()
    const settings = found ?? this.#settingsButton
    if (settings === null || settings.parentElement === null) return
    this.#settingsButton = settings
    const parent = settings.parentElement
    // The entry rides the Settings button's OWN styles (shared DSH chrome
    // classes, including the rail variant) — never a bespoke shape. Keep the
    // class list in sync with the Settings button so rail expand/collapse
    // (which toggles the round rail class) applies to the entry too.
    const settingsClasses = settings.className.replace(/oh-marketplace-nav/g, '').trim()
    if (this.#entry === null) {
      const entry = document.createElement('button')
      entry.type = 'button'
      entry.className = `${settingsClasses} oh-marketplace-nav`.trim()
      entry.dataset.active = String(this.#state.open)
      entry.addEventListener('click', () => { this.toggle() })
      this.#entry = entry
      this.renderEntryLabel()
    } else if (this.#entry.className !== `${settingsClasses} oh-marketplace-nav`.trim()) {
      this.#entry.className = `${settingsClasses} oh-marketplace-nav`.trim()
    }
    // Insert the entry ABOVE the Settings area (the rail's foot stacks
    // vertically: footer actions, then settings). Inserting it inside the
    // settings area made it sit BESIDE the Settings button in the collapsed
    // rail — two icons on one row with the entry overflowing the rail edge.
    let settingsArea: HTMLElement | null = parent
    while (settingsArea !== null && settingsArea !== document.body
      && getComputedStyle(settingsArea).display === 'contents') {
      settingsArea = settingsArea.parentElement
    }
    const foot = settingsArea?.parentElement ?? settingsArea
    if (this.#entry.parentElement !== foot || this.#entry.nextElementSibling !== settingsArea) {
      foot?.insertBefore(this.#entry, settingsArea)
    }
    // NOTE: the entry is inserted next to the DSH Settings button in the
    // sidebar foot. Older revisions also squeezed the settings area to
    // "reserve room for Settings in short windows" by shrinking the
    // settings button's container to `innerHeight − top − 8px`; on the DSH
    // 0.1.x DOM that container sits at the bottom of the rail, so the
    // computed height collapsed to 0 and pushed the Settings button out of
    // the viewport. The squeeze is gone: the marketplace surface is a
    // full-screen overlay, so shrinking the rail serves no purpose.
    const sidebar = sidebarFor(settings)
    if (sidebar === null) return
    this.#resizeObserver?.disconnect()
    this.#resizeObserver?.observe(sidebar)
    const rect = sidebar.getBoundingClientRect()
    const left = rect.right > 0 && rect.right < window.innerWidth * 0.55 ? rect.right : 0
    document.documentElement.style.setProperty('--oh-marketplace-left', `${String(Math.round(left))}px`)
    this.#entry.dataset.collapsed = String(rect.width < 100)
  }

  private renderEntryLabel(): void {
    if (this.#entry === null) return
    const label = this.#t('plugins')
    this.#entry.setAttribute('aria-label', label)
    this.#entry.innerHTML = pluginIcon(label)
  }
}

function SearchIcon(): JSX.Element {
  return <svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
}

function shortCommit(commit: string): string {
  return commit.slice(0, 10)
}

function mechanismLabel(
  plugin: MarketplacePlugin,
  t: Translate<MarketplaceMessage>,
): string {
  return t(`mechanism.${plugin.mechanism}`)
}

function runtimeRiskLabel(
  plugin: MarketplacePlugin,
  t: Translate<MarketplaceMessage>,
): string {
  return t(`risk.${plugin.runtimeRisk}`)
}

function riskReasonLabel(
  reason: MarketplaceRiskReason,
  t: Translate<MarketplaceMessage>,
): string {
  return t(`risk-reason.${reason}`)
}

function confirmationLabel(
  confirmation: MarketplaceConfirmation,
  t: Translate<MarketplaceMessage>,
): string {
  if (confirmation === 'allow-build-scripts') return t('allow-scripts')
  if (confirmation === 'accept-high-risk') return t('accept-high-risk')
  return t('accept-source-change')
}

function PluginCard({
  plugin,
  selected,
  select,
  t,
}: {
  plugin: MarketplacePlugin
  selected: boolean
  select(): void
  t: Translate<MarketplaceMessage>
}): JSX.Element {
  return (
    <button
      className="oh-marketplace-card"
      data-selected={String(selected)}
      onClick={select}
      type="button"
    >
      <div className="oh-marketplace-card-top">
        <span className="oh-marketplace-card-icon">{plugin.title.slice(0, 1)}</span>
        <div style={{ minWidth: 0 }}>
          <h2>{plugin.title}</h2>
          <div className="oh-marketplace-card-category">{plugin.category}</div>
        </div>
      </div>
      <p className="oh-marketplace-card-description">{plugin.description}</p>
      <div className="oh-marketplace-card-footer">
        <span
          className="oh-marketplace-pill"
          data-unsupported={String(plugin.mechanism === 'unsupported')}
        >
          {mechanismLabel(plugin, t)}
        </span>
        {plugin.installed && (
          <span className="oh-marketplace-pill" data-installed="true">
            {t('installed')}
          </span>
        )}
        {plugin.installed && (
          <span className="oh-marketplace-pill" data-installed={String(plugin.enabled)}>
            {plugin.enabled ? t('enabled') : t('disabled')}
          </span>
        )}
        {plugin.updateAvailable && (
          <span className="oh-marketplace-pill" data-update="true">
            {t('update-available')}
          </span>
        )}
        {plugin.protected && (
          <span className="oh-marketplace-pill" data-protected="true">
            {t('managed')}
          </span>
        )}
      </div>
    </button>
  )
}

function PluginDetail({
  bridge,
  pending,
  plugin,
  snapshot,
  locale,
  t,
  close,
  run,
}: {
  bridge: DesktopBridge
  pending: boolean
  plugin: MarketplacePlugin
  snapshot: MarketplaceSnapshot
  locale: LocaleService
  t: Translate<MarketplaceMessage>
  close(): void
  run(command: MarketplaceCommand): Promise<void>
}): JSX.Element {
  const [confirmations, setConfirmations] = useState<MarketplaceConfirmation[]>([])
  const plan = snapshot.plan?.pluginId === plugin.id ? snapshot.plan : null
  const hasScripts = plan !== null && Object.keys(plan.buildScripts).length > 0
  const readyToPreview = plan !== null
    && plan.requirements.every(requirement => confirmations.includes(requirement))
  useEffect(() => { setConfirmations([]) }, [plugin.id, plan?.resolvedCommit])
  const setConfirmed = (
    confirmation: MarketplaceConfirmation,
    confirmed: boolean,
  ): void => {
    setConfirmations(current => confirmed
      ? [...new Set([...current, confirmation])]
      : current.filter(entry => entry !== confirmation))
  }
  return (
    <aside
      className="oh-marketplace-detail"
      aria-label={t('details', { plugin: plugin.title })}
    >
      <div className="oh-marketplace-detail-inner">
        <button className="oh-marketplace-icon-button oh-marketplace-detail-close" onClick={close} type="button"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>
        <h2>{plugin.title}</h2>
        <span className="oh-marketplace-pill" data-installed={String(plugin.installed)}>
          {plugin.installed ? t('installed') : mechanismLabel(plugin, t)}
        </span>
        <p className="oh-marketplace-detail-description">{plugin.description}</p>
        <dl className="oh-marketplace-facts">
          <dt>{t('category')}</dt><dd>{plugin.category}</dd>
          <dt>{t('mechanism')}</dt><dd>{mechanismLabel(plugin, t)}</dd>
          <dt>{t('updated')}</dt>
          <dd>
            {plugin.pushedAt === null
              ? t('unknown')
              : new Date(plugin.pushedAt).toLocaleString(localeTag(locale))}
          </dd>
          <dt>{t('repository')}</dt><dd>{plugin.url.replace('https://github.com/', '')}</dd>
          <dt>{t('trust')}</dt><dd>{t(`trust.${plugin.trust}`)}</dd>
          <dt>{t('runtime-boundary')}</dt><dd>{runtimeRiskLabel(plugin, t)}</dd>
          {plugin.currentCommit !== null && (
            <><dt>{t('current-commit')}</dt><dd>{shortCommit(plugin.currentCommit)}</dd></>
          )}
          {plugin.latestCommit !== null && (
            <><dt>{t('latest-commit')}</dt><dd>{shortCommit(plugin.latestCommit)}</dd></>
          )}
        </dl>

        {plan !== null && (
          <section className="oh-marketplace-plan">
            <div className="oh-marketplace-flow" aria-label={t('prepared-plan', { action: t(`action.${plan.action}`) })}>
              <span data-active="true">1 · {t('flow.review')}</span>
              <span data-active={String(snapshot.preview !== null)}>2 · {t('flow.preview')}</span>
              <span>3 · {t('flow.apply')}</span>
            </div>
            <h3>{t('prepared-plan', { action: t(`action.${plan.action}`) })}</h3>
            <div className="oh-marketplace-plan-risk" data-risk={plan.riskLevel}>
              <strong>{t('risk-level')}: {t(`risk-level.${plan.riskLevel}`)}</strong>
              <span>{t('source-review')}: {t(`source-review.${plan.sourceReview}`)}</span>
            </div>
            {plan.riskReasons.length > 0 && (
              <ul className="oh-marketplace-risk-reasons">
                {plan.riskReasons.map(reason => (
                  <li key={reason}>{riskReasonLabel(reason, t)}</li>
                ))}
              </ul>
            )}
            <code>{plan.source}</code>
            <code>{t('commit', { commit: shortCommit(plan.resolvedCommit) })}</code>
            {plan.packageName !== null && (
              <code>{t('package', { package: plan.packageName })}</code>
            )}
            {hasScripts && (
              <code>{Object.entries(plan.buildScripts).map(([name, script]) => `${name}: ${script}`).join('\n')}</code>
            )}
            {plan.requirements.map(requirement => (
              <label className="oh-marketplace-confirm" key={requirement}>
                  <input
                    checked={confirmations.includes(requirement)}
                    onChange={event => { setConfirmed(requirement, event.target.checked) }}
                    type="checkbox"
                  />
                  <span>{confirmationLabel(requirement, t)}</span>
              </label>
            ))}
            <p className="oh-marketplace-recovery-note">{t('recovery-note')}</p>
          </section>
        )}

        <div className="oh-marketplace-detail-actions">
          {plugin.mechanism === 'unsupported' || plugin.protected ? (
            <button className="oh-marketplace-button" onClick={() => { void bridge.openExternal(plugin.url) }} type="button">
              {t('open-repository')}
            </button>
          ) : plan === null ? (
            <>
              {!plugin.installed && (
                <button
                  className="oh-marketplace-button"
                  data-primary="true"
                  disabled={pending}
                  onClick={() => { void run({
                    type: 'prepare',
                    action: 'install',
                    pluginId: plugin.id,
                  }) }}
                  type="button"
                >
                  {t('preview.install')}
                </button>
              )}
              {plugin.installed && plugin.updateAvailable && (
                <button
                  className="oh-marketplace-button"
                  data-primary="true"
                  disabled={pending}
                  onClick={() => { void run({
                    type: 'prepare',
                    action: 'update',
                    pluginId: plugin.id,
                  }) }}
                  type="button"
                >
                  {t('preview.update')}
                </button>
              )}
              {plugin.installed && (
                <button
                  className="oh-marketplace-button"
                  disabled={pending}
                  onClick={() => { void run({
                    type: 'prepare',
                    action: plugin.enabled ? 'disable' : 'enable',
                    pluginId: plugin.id,
                  }) }}
                  type="button"
                >
                  {plugin.enabled ? t('preview.disable') : t('preview.enable')}
                </button>
              )}
              {plugin.installed && (
                <button
                  className="oh-marketplace-button"
                  data-danger="true"
                  disabled={pending}
                  onClick={() => { void run({
                    type: 'prepare',
                    action: 'uninstall',
                    pluginId: plugin.id,
                  }) }}
                  type="button"
                >
                  {t('preview.uninstall')}
                </button>
              )}
            </>
          ) : snapshot.preview === null ? (
            <button
              className="oh-marketplace-button"
              data-primary="true"
              disabled={pending || !readyToPreview}
              onClick={() => { void run({ type: 'preview', confirmations }) }}
              type="button"
            >
              {t('preview.launch')}
            </button>
          ) : null}
          <button className="oh-marketplace-button" onClick={() => { void bridge.openExternal(plugin.url) }} type="button">
            {t('view-source')}
          </button>
        </div>
      </div>
    </aside>
  )
}

function localizedAuthDetail(
  detail: string,
  t: Translate<MarketplaceMessage>,
): string {
  if (detail.startsWith('Install GitHub CLI')) return t('auth.install-gh')
  if (detail === 'Authenticated with GitHub CLI.') return t('auth.ready')
  if (detail === 'Plugin catalog has not been refreshed yet.') {
    return t('auth.not-refreshed')
  }
  return detail
}

function localizedHostMessage(
  message: string,
  t: Translate<MarketplaceMessage>,
): string {
  let match = /^Loaded (\d+) catalog plugins\.$/.exec(message)
  if (match !== null) return t('notice.loaded', { count: match[1] })
  match = /^Isolated (install|update|enable|disable|uninstall) preview is ready for (.+)\.$/.exec(message)
  if (match !== null) {
    const action = t(`action.${match[1] as 'install' | 'update' | 'enable' | 'disable' | 'uninstall'}`)
    return t('notice.preview-ready', { action, plugin: match[2] })
  }
  match = /^Discarded the (.+) preview without changing the desktop profile\.$/.exec(message)
  if (match !== null) return t('notice.discarded', { plugin: match[1] })
  match = /^Applied (.+); the previous profile remains available for Undo\.$/.exec(message)
  if (match !== null) return t('notice.applied', { plugin: match[1] })
  match = /^Restored the profile from before (.+) was applied\.$/.exec(message)
  if (match !== null) return t('notice.restored', { plugin: match[1] })
  return message
}

function MarketplaceSurface({ bridge, locale, translate, view }: {
  bridge: DesktopBridge
  locale: LocaleService
  translate: Translate<MarketplaceMessage>
  view: PluginMarketplaceViewService
}): JSX.Element {
  const t = useTranslate(locale, translate)
  const viewState = useSyncExternalStore(view.subscribe, view.getSnapshot)
  const [snapshot, setSnapshot] = useState<MarketplaceSnapshot | null>(null)
  const [pending, setPending] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'installed' | 'available' | 'updates' | 'disabled'
  >('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const run = useCallback(async (command: MarketplaceCommand): Promise<void> => {
    setPending(true)
    setLocalError(null)
    try {
      setSnapshot(await bridge.pluginMarketplace.dispatch(command))
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }, [bridge])

  useEffect(() => {
    let alive = true
    void bridge.pluginMarketplace.getSnapshot().then(initial => {
      if (!alive) return
      setSnapshot(initial)
      return bridge.pluginMarketplace.dispatch({ type: 'refresh' })
    }).then(refreshed => {
      if (alive && refreshed !== undefined) setSnapshot(refreshed)
    }).catch((error: unknown) => {
      if (alive) setLocalError(error instanceof Error ? error.message : String(error))
    })
    return () => { alive = false }
  }, [bridge])

  const categories = useMemo(() => {
    return [...new Set(snapshot?.catalog.map(plugin => plugin.category) ?? [])].sort()
  }, [snapshot?.catalog])
  const statusCounts = useMemo(() => {
    const catalog = snapshot?.catalog ?? []
    const installed = catalog.filter(plugin => plugin.installed).length
    return {
      all: catalog.length,
      available: catalog.length - installed,
      disabled: catalog.filter(plugin => plugin.installed && !plugin.enabled).length,
      installed,
      updates: catalog.filter(plugin => plugin.updateAvailable).length,
    }
  }, [snapshot?.catalog])
  const plugins = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (snapshot?.catalog ?? []).filter(plugin => {
      if (statusFilter === 'installed' && !plugin.installed) return false
      if (statusFilter === 'available' && plugin.installed) return false
      if (statusFilter === 'updates' && !plugin.updateAvailable) return false
      if (statusFilter === 'disabled' && (!plugin.installed || plugin.enabled)) return false
      if (categoryFilter !== 'all' && plugin.category !== categoryFilter) return false
      return needle === '' || [plugin.title, plugin.description, plugin.category, ...plugin.tags]
        .some(value => value.toLowerCase().includes(needle))
    })
  }, [categoryFilter, search, snapshot?.catalog, statusFilter])
  const selected = plugins.find(plugin => plugin.id === selectedId) ?? null
  const error = localError ?? snapshot?.error ?? null
  const resetView = (): void => {
    setSearch('')
    setStatusFilter('all')
    setCategoryFilter('all')
    setSelectedId(null)
  }

  useEffect(() => {
    if (viewState.open) resetView()
  }, [viewState.open])

  return (
    <div className="oh-marketplace-surface" data-open={String(viewState.open)} aria-hidden={!viewState.open}>
      <div className="oh-marketplace-app">
        <div>
          <header className="oh-marketplace-header">
            <div className="oh-marketplace-heading">
              <h1>{t('plugins')}</h1>
              <p>{t('subtitle')}</p>
            </div>
            <div className="oh-marketplace-header-actions">
              {snapshot?.undoAvailable === true && (
                <button className="oh-marketplace-button" disabled={pending} onClick={() => { void run({ type: 'undo' }) }} type="button">
                  {t('undo-last-apply')}
                </button>
              )}
              <button className="oh-marketplace-button" disabled={pending} onClick={() => { void run({ type: 'refresh' }) }} type="button">
                {pending ? t('working') : t('refresh')}
              </button>
              <button
                className="oh-marketplace-icon-button"
                onClick={() => { view.setOpen(false) }}
                title={t('close')}
                type="button"
              ><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>
            </div>
          </header>
          {snapshot?.preview !== null && snapshot?.preview !== undefined && (
            <div className="oh-marketplace-preview-banner">
              <strong>{t('preview.running', { plugin: snapshot.preview.pluginId })}</strong>
              <button className="oh-marketplace-button" disabled={pending} onClick={() => { void run({ type: 'discard' }) }} type="button">
                {t('discard')}
              </button>
              <button className="oh-marketplace-button" data-primary="true" disabled={pending} onClick={() => { void run({ type: 'apply' }) }} type="button">
                {t('apply-action', { action: t(`action.${snapshot.preview.action}`) })}
              </button>
            </div>
          )}
          {error !== null && (
            <div className="oh-marketplace-error">
              <span>{error}</span>
              <button
                className="oh-marketplace-button"
                disabled={pending}
                onClick={() => { resetView(); void run({ type: 'refresh' }) }}
                type="button"
              >
                {t('reset-and-reload')}
              </button>
            </div>
          )}
          {snapshot?.lastAction !== null && snapshot?.lastAction !== undefined && error === null && (
            <div className="oh-marketplace-notice">
              {localizedHostMessage(snapshot.lastAction, t)}
            </div>
          )}
        </div>
        <div className="oh-marketplace-layout" data-detail={String(selected !== null)}>
          <main className="oh-marketplace-main">
            <div className="oh-marketplace-toolbar">
              <div className="oh-marketplace-search">
                <SearchIcon />
                <input
                  aria-label={t('search.label')}
                  onChange={event => { setSearch(event.target.value) }}
                  placeholder={t('search.placeholder')}
                  value={search}
                />
                {search !== '' && (
                  <button aria-label={t('search.clear')} onClick={() => { setSearch('') }} type="button"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>
                )}
              </div>
              <div className="oh-marketplace-status-tabs" role="group" aria-label={t('installation-status')}>
                {([
                  ['all', t('all')],
                  ['installed', t('installed')],
                  ['available', t('not-installed')],
                  ['updates', t('updates')],
                  ['disabled', t('disabled')],
                ] as const).map(([value, label]) => (
                  <button
                    data-active={String(statusFilter === value)}
                    key={value}
                    onClick={() => { setStatusFilter(value) }}
                    type="button"
                  >
                    {label}<span>{statusCounts[value]}</span>
                  </button>
                ))}
              </div>
              <select
                aria-label={t('plugin-category')}
                className="oh-marketplace-filter"
                onChange={event => { setCategoryFilter(event.target.value) }}
                value={categoryFilter}
              >
                <option value="all">{t('all-categories')}</option>
                {categories.map(category => <option key={category} value={category}>{category}</option>)}
              </select>
              <span className="oh-marketplace-count">
                {t('plugin-count', { count: plugins.length })}
              </span>
            </div>
            {snapshot === null || pending && snapshot.catalog.length === 0 ? (
              <div className="oh-marketplace-empty">{t('loading-catalog')}</div>
            ) : snapshot.auth.status !== 'ready' && snapshot.catalog.length === 0 ? (
              <div className="oh-marketplace-empty">
                <div>
                  <strong>{t('github-auth-required')}</strong><br />
                  {localizedAuthDetail(snapshot.auth.detail, t)}
                </div>
              </div>
            ) : plugins.length === 0 ? (
              <div className="oh-marketplace-empty">{t('no-match')}</div>
            ) : (
              <div className="oh-marketplace-grid">
                {plugins.map(plugin => (
                  <PluginCard
                    key={plugin.id}
                    plugin={plugin}
                    selected={selectedId === plugin.id}
                    select={() => { setSelectedId(plugin.id) }}
                    t={t}
                  />
                ))}
              </div>
            )}
          </main>
          {selected !== null && snapshot !== null && (
            <PluginDetail
              bridge={bridge}
              pending={pending}
              plugin={selected}
              snapshot={snapshot}
              locale={locale}
              t={t}
              close={() => { setSelectedId(null) }}
              run={run}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function apply(ctx: ClientContext): void {
  const bridge = window.dshDesktop
  if (bridge === undefined) throw new Error('plugin-marketplace: Electron bridge is unavailable')
  const locale = ctx.get('locale') as LocaleService
  const sessions = ctx.get('sessions') as SessionsService
  const t: Translate<MarketplaceMessage> = locale.bind('oh-dsh.plugin-marketplace')
  const view = new PluginMarketplaceViewService(bridge, locale, t, sessions)
  ctx.effect(
    () => locale.register('oh-dsh.plugin-marketplace', MARKETPLACE_MESSAGES),
    'oh-dsh-desktop: marketplace dictionaries',
  )
  ctx.effect(() => {
    let disposed = false
    let disposeProvider: (() => Promise<void> | void) | void
    void bridge.getInfo().then(info => {
      if (disposed || info.preview !== null) return
      view.mount()
      disposeProvider = ctx.reflect.provide('pluginMarketplace', view, undefined)
    }).catch((error: unknown) => {
      console.error('plugin-marketplace: failed to inspect the desktop window', error)
    })
    return () => {
      disposed = true
      view.dispose()
      if (typeof disposeProvider === 'function') void disposeProvider()
    }
  }, 'oh-dsh-desktop: plugin marketplace')
}

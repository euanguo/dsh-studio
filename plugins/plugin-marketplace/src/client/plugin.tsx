import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { DesktopBridge } from '@oh-dsh/shared/desktop-contracts'
import { ensureStyle } from '@oh-dsh/shared/style-injector'
import { Scrollable } from '@oh-dsh/shared/scrollable'
import type { LocaleService, Translate } from '@oh-dsh/shared/i18n'
import { localeTag } from '@oh-dsh/shared/i18n'
import { useTranslate } from '@oh-dsh/shared/use-i18n'
import {
  Button,
  IconCordisPluginOutline14,
  Input,
  Menu,
  Modal,
  Pill,
  RiskConfirmation,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronDown, IconClose, IconSearch } from '@oh-dsh/shared/tabler-icons'
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
  available: boolean
  open: boolean
}

interface ObservableSnapshot<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface SessionsService {
  list: ObservableSnapshot<SessionListSnapshot>
}

interface MarketplaceNavigationProps {
  locale: LocaleService
  t: Translate<MarketplaceMessage>
  view: PluginMarketplaceView
  wide: boolean
}

interface SlotsService {
  inject(name: string, register: () => unknown): void
  register(options: {
    id: string
    inject(): Omit<MarketplaceNavigationProps, 'wide'>
    locale: string
    name: string
    order: number
  }, component: (props: MarketplaceNavigationProps) => JSX.Element | null): unknown
}

interface PluginMarketplaceView {
  getSnapshot(): MarketplaceViewState
  setOpen(open: boolean): void
  subscribe(listener: () => void): () => void
  toggle(): void
}

declare global {
  interface Window {
    dshDesktop?: DesktopBridge
  }
}

export const inject = ['locale', 'sessions', 'slots']

const OPEN_KEY = 'oh-dsh-desktop.plugin-marketplace.open'
const FOOTER_STACK_ATTRIBUTE = 'data-oh-dsh-marketplace-footer-stack'

function readOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) === 'true' } catch { return false }
}

function persistOpen(open: boolean): void {
  try { localStorage.setItem(OPEN_KEY, String(open)) } catch { /* best effort */ }
}

function settingsButton(): HTMLButtonElement | null {
  const visible = (button: HTMLButtonElement): boolean => {
    const rect = button.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }
  const byBottom = (left: HTMLButtonElement, right: HTMLButtonElement): number =>
    right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom
  // rc.5 wraps the trigger content in a stable slot marker; the rail trigger
  // is the one inside the sidebar (the open settings panel may render a copy).
  const slotted = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.querySelector('[data-slot="settings.trigger"]') !== null
      && button.closest('[data-slot="sidebar"]') !== null
      && visible(button))
  if (slotted !== undefined) return slotted
  const labeled = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .filter(button => {
      if (!visible(button)) return false
      const label = [
        button.textContent,
        button.getAttribute('aria-label'),
        button.getAttribute('title'),
      ].filter(Boolean).join(' ').trim().toLowerCase()
      return label.includes('settings') || label.includes('设置')
    })
  if (labeled.length > 0) return labeled.sort(byBottom)[0] ?? null
  // rc.5's collapsed rail renders the settings trigger as an icon-only
  // dialog-opener at the rail foot, with no accessible settings label.
  const railTriggers = [...document.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="dialog"]')]
    .filter(button => button.closest('[data-slot="sidebar"]') !== null && visible(button))
  return railTriggers.sort(byBottom)[0] ?? null
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

function marketplaceFooter(settings: HTMLElement): HTMLElement | null {
  const navigation = document.querySelector<HTMLElement>('.oh-marketplace-nav')
  if (navigation === null) return null
  let candidate = navigation.parentElement
  while (candidate !== null && candidate !== document.body) {
    if (candidate.contains(settings)) return candidate
    candidate = candidate.parentElement
  }
  return null
}

function MarketplaceNavigationEntry({
  locale,
  t,
  view,
  wide,
}: MarketplaceNavigationProps): JSX.Element | null {
  const state = useSyncExternalStore(view.subscribe, view.getSnapshot)
  const translate = useTranslate(locale, t)
  if (!state.available) return null
  const label = translate('plugins')
  return (
    <button
      aria-label={label}
      className="oh-marketplace-nav"
      data-active={String(state.open)}
      data-collapsed={String(!wide)}
      onClick={() => { view.toggle() }}
      type="button"
    >
      <IconCordisPluginOutline14 size={16} />
      {wide && <span>{label}</span>}
    </button>
  )
}

class PluginMarketplaceViewService implements PluginMarketplaceView {
  readonly #bridge: DesktopBridge
  readonly #locale: LocaleService
  readonly #t: Translate<MarketplaceMessage>
  readonly #sessions: SessionsService
  readonly #listeners = new Set<() => void>()
  #state: MarketplaceViewState = { available: false, open: readOpen() }
  #element: HTMLDivElement | null = null
  #stopStyle: (() => void) | null = null
  #root: Root | null = null
  #observer: MutationObserver | null = null
  #geometryFrame: number | null = null
  #footerStack: HTMLElement | null = null
  #unsubscribeSessions: (() => void) | null = null
  #sessionNavigationState: SessionNavigationState = initialSessionNavigationState()
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

  setOpen(open: boolean): void {
    if (this.#state.open === open) return
    this.#state = { ...this.#state, open }
    persistOpen(open)
    for (const listener of this.#listeners) listener()
  }

  toggle(): void { this.setOpen(!this.#state.open) }

  mount(): void {
    this.#sessionNavigationState = initialSessionNavigationState()
    /* scrollable.css is injected once by the sidebar's workspace-tools
       chain (this plugin always co-loads with the sidebar); re-injecting
       it here duplicated every rule and let the later style tag clobber
       consumer borders (the diff-tree divider). Only marketplace's own
       styles are injected here. */
    this.#stopStyle = ensureStyle('oh-dsh-plugin-marketplace', marketplaceCss)

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

    this.#state = { ...this.#state, available: true }
    for (const listener of this.#listeners) listener()

    this.#observer = new MutationObserver(() => {
      if (this.#state.open && settingsDialogOpen()) this.setOpen(false)
      this.scheduleGeometry()
    })
    this.#observer.observe(document.body, { childList: true, subtree: true })
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
    this.#root?.unmount()
    this.#footerStack?.removeAttribute(FOOTER_STACK_ATTRIBUTE)
    this.#footerStack = null
    this.#element?.remove()
    this.#stopStyle?.()
    this.#stopStyle = null
    this.#state = { available: false, open: false }
    for (const listener of this.#listeners) listener()
  }

  private scheduleGeometry(): void {
    if (this.#geometryFrame !== null) return
    this.#geometryFrame = requestAnimationFrame(() => {
      this.#geometryFrame = null
      this.synchronizeGeometry()
    })
  }

  private synchronizeGeometry(): void {
    const settings = settingsButton()
    const footerStack = settings === null ? null : marketplaceFooter(settings)
    if (footerStack === this.#footerStack) return
    this.#footerStack?.removeAttribute(FOOTER_STACK_ATTRIBUTE)
    footerStack?.setAttribute(FOOTER_STACK_ATTRIBUTE, 'true')
    this.#footerStack = footerStack
  }
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

function pluginMeta(
  plugin: MarketplacePlugin,
  t: Translate<MarketplaceMessage>,
): string {
  const parts = [plugin.category, mechanismLabel(plugin, t)]
  if (plugin.installed) parts.push(plugin.enabled ? t('enabled') : t('disabled'))
  else parts.push(t('not-installed'))
  if (plugin.updateAvailable) parts.push(t('update-available'))
  if (plugin.protected) parts.push(t('managed'))
  return parts.join(' · ')
}

function CategoryMenu({
  categories,
  value,
  t,
  onChange,
}: {
  categories: readonly string[]
  value: string
  t: Translate<MarketplaceMessage>
  onChange(value: string): void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const items: MenuEntry[] = [
    { id: 'all', label: t('all-categories') },
    ...categories.map(category => ({ id: category, label: category })),
  ]
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={items}
      selectedId={value}
      align="end"
      portal
      compact
      onSelect={(id) => {
        setOpen(false)
        onChange(id)
      }}
      anchor={(
        <button
          type="button"
          className="oh-marketplace-selector"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('plugin-category')}
          onClick={() => { setOpen(current => !current) }}
        >
          {value === 'all' ? t('all-categories') : value}
          <IconChevronDown size={14} />
        </button>
      )}
    />
  )
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
      <h2>{plugin.title}</h2>
      <div className="oh-marketplace-card-meta">{pluginMeta(plugin, t)}</div>
      <p className="oh-marketplace-card-description">{plugin.description}</p>
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
  const actions = (
    <div className="oh-marketplace-detail-actions">
      {plugin.mechanism === 'unsupported' || plugin.protected ? (
        <Button variant="outline" size="sm" onClick={() => { void bridge.openExternal(plugin.url) }}>
          {t('open-repository')}
        </Button>
      ) : plan === null ? (
        <>
          {!plugin.installed && (
            <Button
              variant="primary"
              size="sm"
              disabled={pending}
              onClick={() => { void run({
                type: 'prepare',
                action: 'install',
                pluginId: plugin.id,
              }) }}
            >
              {t('preview.install')}
            </Button>
          )}
          {plugin.installed && plugin.updateAvailable && (
            <Button
              variant="primary"
              size="sm"
              disabled={pending}
              onClick={() => { void run({
                type: 'prepare',
                action: 'update',
                pluginId: plugin.id,
              }) }}
            >
              {t('preview.update')}
            </Button>
          )}
          {plugin.installed && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => { void run({
                type: 'prepare',
                action: plugin.enabled ? 'disable' : 'enable',
                pluginId: plugin.id,
              }) }}
            >
              {plugin.enabled ? t('preview.disable') : t('preview.enable')}
            </Button>
          )}
          {plugin.installed && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => { void run({
                type: 'prepare',
                action: 'uninstall',
                pluginId: plugin.id,
              }) }}
            >
              {t('preview.uninstall')}
            </Button>
          )}
        </>
      ) : snapshot.preview === null ? (
        <Button
          variant="primary"
          size="sm"
          disabled={pending || !readyToPreview}
          onClick={() => { void run({ type: 'preview', confirmations }) }}
        >
          {t('preview.launch')}
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={() => { void bridge.openExternal(plugin.url) }}>
        {t('view-source')}
      </Button>
    </div>
  )
  return (
    <Modal
      open
      onClose={close}
      title={plugin.title}
      description={pluginMeta(plugin, t)}
      closeLabel={t('close')}
      className="oh-marketplace-dialog"
      contentClassName="oh-marketplace-dialog-content"
      footer={actions}
    >
      <div className="oh-marketplace-detail" aria-label={t('details', { plugin: plugin.title })}>
        <p className="oh-marketplace-detail-copy">{plugin.description}</p>
        <dl className="oh-marketplace-facts">
          <dt>{t('updated')}</dt>
          <dd>
            {plugin.pushedAt === null
              ? t('unknown')
              : new Date(plugin.pushedAt).toLocaleString(localeTag(locale))}
          </dd>
          <dt>{t('repository')}</dt>
          <dd>{plugin.url.replace('https://github.com/', '')}</dd>
          <dt>{t('trust')}</dt>
          <dd>{t(`trust.${plugin.trust}`)}</dd>
          <dt>{t('runtime-boundary')}</dt>
          <dd>{runtimeRiskLabel(plugin, t)}</dd>
          {plugin.currentCommit !== null && (
            <>
              <dt>{t('current-commit')}</dt>
              <dd>{shortCommit(plugin.currentCommit)}</dd>
            </>
          )}
          {plugin.latestCommit !== null && (
            <>
              <dt>{t('latest-commit')}</dt>
              <dd>{shortCommit(plugin.latestCommit)}</dd>
            </>
          )}
        </dl>
        {plan !== null && (
          <section className="oh-marketplace-plan">
            <h3>{t('prepared-plan', { action: t(`action.${plan.action}`) })}</h3>
            <div className="oh-marketplace-flow" aria-label={t('prepared-plan', { action: t(`action.${plan.action}`) })}>
              <span data-active="true">1 · {t('flow.review')}</span>
              <span data-active={String(snapshot.preview !== null)}>2 · {t('flow.preview')}</span>
              <span>3 · {t('flow.apply')}</span>
            </div>
            <dl className="oh-marketplace-facts">
              <dt>{t('risk-level')}</dt>
              <dd data-risk={plan.riskLevel}>{t(`risk-level.${plan.riskLevel}`)}</dd>
              <dt>{t('source-review')}</dt>
              <dd>{t(`source-review.${plan.sourceReview}`)}</dd>
              <dt>{t('repository')}</dt>
              <dd>{plan.source}</dd>
              <dt>{t('latest-commit')}</dt>
              <dd>{shortCommit(plan.resolvedCommit)}</dd>
            </dl>
            {plan.packageName !== null && (
              <p className="oh-marketplace-plan-line">{t('package', { package: plan.packageName })}</p>
            )}
            {plan.riskReasons.length > 0 && (
              <ul className="oh-marketplace-risk-reasons">
                {plan.riskReasons.map(reason => (
                  <li key={reason}>{riskReasonLabel(reason, t)}</li>
                ))}
              </ul>
            )}
            {hasScripts && (
              <pre className="oh-marketplace-scripts">
                {Object.entries(plan.buildScripts).map(([name, script]) => `${name}: ${script}`).join('\n')}
              </pre>
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
      </div>
    </Modal>
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
  const [pending, setPending] = useState(true)
  const [localError, setLocalError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'installed' | 'available' | 'updates' | 'disabled'
  >('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [applyAcknowledged, setApplyAcknowledged] = useState(false)

  const run = useCallback(async (command: MarketplaceCommand): Promise<void> => {
    setPending(true)
    setLocalError(null)
    try {
      setSnapshot(await bridge.pluginMarketplace.dispatch(command) as MarketplaceSnapshot)
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }, [bridge])

  useEffect(() => {
    let alive = true
    setPending(true)
    setLocalError(null)
    void bridge.pluginMarketplace.getSnapshot().then(initial => {
      if (!alive) return
      setSnapshot(initial as MarketplaceSnapshot)
      return bridge.pluginMarketplace.dispatch({ type: 'refresh' })
    }).then(refreshed => {
      if (alive && refreshed !== undefined) setSnapshot(refreshed as MarketplaceSnapshot)
    }).catch((error: unknown) => {
      if (alive) setLocalError(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      if (alive) setPending(false)
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
  const loadedNotice = snapshot !== null
    ? t('notice.loaded', { count: snapshot.catalog.length })
    : null
  const lastAction = snapshot?.lastAction ?? null
  const lastActionNotice = lastAction === null || error !== null
    ? null
    : localizedHostMessage(lastAction, t)
  const showActionNotice = lastActionNotice !== null
    && lastActionNotice !== loadedNotice
  const resetView = (): void => {
    setSearch('')
    setStatusFilter('all')
    setCategoryFilter('all')
    setSelectedId(null)
  }

  useEffect(() => {
    if (viewState.open) resetView()
    else setSelectedId(null)
  }, [viewState.open])

  return (
    <>
      <Modal
        open={viewState.open}
        onClose={() => { view.setOpen(false) }}
        title={t('plugins')}
        description={loadedNotice === null ? t('subtitle') : `${t('subtitle')} ${loadedNotice}`}
        closeLabel={t('close')}
        className="oh-marketplace-shell"
        contentClassName="oh-marketplace-shell-content"
        footer={(
          <div className="oh-marketplace-shell-footer">
            <span className="oh-marketplace-count">
              {t('plugin-count', { count: plugins.length })}
            </span>
            {snapshot?.undoAvailable === true && (
              <Button variant="outline" size="sm" disabled={pending} onClick={() => { void run({ type: 'undo' }) }}>
                {t('undo-last-apply')}
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={pending} onClick={() => { void run({ type: 'refresh', force: true }) }}>
              {pending ? t('working') : t('refresh')}
            </Button>
          </div>
        )}
      >
        <div className="oh-marketplace-app">
        {snapshot?.preview !== null && snapshot?.preview !== undefined && (
          <div className="oh-marketplace-preview-banner">
            <strong>{t('preview.running', { plugin: snapshot.preview.pluginId })}</strong>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => { void run({ type: 'discard' }) }}>
              {t('discard')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={pending}
              onClick={() => {
                setApplyAcknowledged(false)
                setApplyOpen(true)
              }}
            >
              {t('apply-action', { action: t(`action.${snapshot.preview.action}`) })}
            </Button>
          </div>
        )}
        {error !== null && (
          <div className="oh-marketplace-error">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => { resetView(); void run({ type: 'refresh', force: true }) }}
            >
              {t('reset-and-reload')}
            </Button>
          </div>
        )}
        {showActionNotice && (
          <div className="oh-marketplace-notice">
            {lastActionNotice}
          </div>
        )}
        <div className="oh-marketplace-toolbar">
          <div className="oh-marketplace-search">
            <Input
              icon={<IconSearch size={16} />}
              aria-label={t('search.label')}
              onChange={event => { setSearch(event.target.value) }}
              placeholder={t('search.placeholder')}
              value={search}
            />
            {search !== '' && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('search.clear')}
                icon={<IconClose size={14} />}
                onClick={() => { setSearch('') }}
              />
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
              <Pill
                active={statusFilter === value}
                key={value}
                onClick={() => { setStatusFilter(value) }}
              >
                {label}<span>{statusCounts[value]}</span>
              </Pill>
            ))}
          </div>
          <CategoryMenu
            categories={categories}
            value={categoryFilter}
            t={t}
            onChange={setCategoryFilter}
          />
        </div>
        <Scrollable className="oh-marketplace-main">
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
        </Scrollable>
        </div>
      </Modal>
      {viewState.open && selected !== null && snapshot !== null && (
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
      {snapshot?.preview !== null && snapshot?.preview !== undefined && (
        <RiskConfirmation
          open={applyOpen}
          title={t('apply-action', { action: t(`action.${snapshot.preview.action}`) })}
          description={t('recovery-note')}
          acknowledgeLabel={t('apply-acknowledge')}
          cancelLabel={t('cancel')}
          confirmLabel={t('apply-to-desktop')}
          acknowledged={applyAcknowledged}
          disabled={pending}
          onAcknowledgedChange={setApplyAcknowledged}
          onCancel={() => { setApplyOpen(false) }}
          onConfirm={() => {
            setApplyOpen(false)
            void run({ type: 'apply' })
          }}
        />
      )}
    </>
  )
}

export function apply(ctx: ClientContext): void {
  // Three-surface adaptation: the marketplace lifecycle runs over the
  // Electron bridge, which only the desktop shell provides. On the web
  // surface the marketplace is skipped (its HTTP transport is a roadmap
  // item); the TUI surface has no browser client graph at all. Skipping
  // instead of throwing keeps a miscomposed profile from crashing the
  // client graph.
  const bridge = window.dshDesktop
  if (bridge === undefined) {
    console.info('plugin-marketplace: skipped, the plugin marketplace is desktop-only')
    return
  }
  const locale = ctx.get('locale') as LocaleService
  const sessions = ctx.get('sessions') as SessionsService
  const slots = ctx.get('slots') as SlotsService
  const t: Translate<MarketplaceMessage> = locale.bind('oh-dsh.plugin-marketplace')
  const view = new PluginMarketplaceViewService(bridge, locale, t, sessions)
  ctx.effect(
    () => locale.register('oh-dsh.plugin-marketplace', MARKETPLACE_MESSAGES),
    'oh-dsh-desktop: marketplace dictionaries',
  )
  slots.inject('sidebar.footer.action', () => slots.register({
    name: 'sidebar.footer.action',
    id: 'oh-dsh-plugin-marketplace',
    order: 80,
    locale: 'oh-dsh.plugin-marketplace',
    inject: () => ({ locale, t, view }),
  }, MarketplaceNavigationEntry))
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

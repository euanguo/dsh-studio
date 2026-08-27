import { useCallback, useEffect, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button, Input, Modal, Pill, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import { Alert, AlertAction, AlertDescription, EmptyState, LoadingState, ScrollArea, ToolbarAction } from '@dsh-studio/shared/ui'
import { toast } from '@dsh-studio/shared/toast'
import { localeTag, type LocaleService, type Translate } from '@dsh-studio/shared/i18n'
import { IconClose, IconSearch } from '@dsh-studio/shared/tabler-icons'
import type { DesktopBridge } from '@dsh-studio/shared/desktop-contracts'
import type { MarketplaceCommand, MarketplacePlugin, MarketplaceSnapshot, MarketplaceSort } from '../protocol.ts'
import type { MarketplaceMessage } from './i18n.ts'
import { CategoryMenu, PluginCard, SortMenu } from './marketplace-browse.tsx'
import { PluginDetail } from './plugin-detail.tsx'
import { resolveMarketplaceScrollViewport } from './marketplace-dom.ts'
import { localizedHostMessage, marketplaceActionNotice, localizedAuthDetail, marketplaceLoadedNotice } from './marketplace-notices.ts'
import type { MarketplaceDispatchOutcome } from './store.ts'
import { localizedDescription, sortMarketplacePlugins } from './marketplace-meta.ts'

export type StatusFilter = 'all' | 'installed' | 'available' | 'updates' | 'disabled'

export interface MarketplaceFilters {
  search: string
  setSearch(value: string): void
  repositoryInput: string
  setRepositoryInput(value: string): void
  statusFilter: StatusFilter
  setStatusFilter(value: StatusFilter): void
  categoryFilter: string
  setCategoryFilter(value: string): void
  sort: MarketplaceSort
  setSort(value: MarketplaceSort): void
  selectedId: string | null
  setSelectedId(value: string | null): void
  reset(): void
}

export function useMarketplaceFilters(): MarketplaceFilters {
  const [search, setSearch] = useState('')
  const [repositoryInput, setRepositoryInput] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [sort, setSort] = useState<MarketplaceSort>('smart')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const reset = useCallback((): void => {
    setSearch('')
    setRepositoryInput('')
    setStatusFilter('all')
    setCategoryFilter('all')
    setSort('smart')
    setSelectedId(null)
  }, [])
  return { search, setSearch, repositoryInput, setRepositoryInput, statusFilter, setStatusFilter, categoryFilter, setCategoryFilter, sort, setSort, selectedId, setSelectedId, reset }
}

export interface MarketplaceCatalogView {
  categories: readonly string[]
  statusCounts: Record<StatusFilter, number>
  plugins: MarketplacePlugin[]
  watchlist: MarketplacePlugin[]
}

export function deriveMarketplaceCatalog(snapshot: MarketplaceSnapshot | null, filters: MarketplaceFilters): MarketplaceCatalogView {
  const catalog = snapshot?.catalog ?? []
  const installed = catalog.filter(plugin => plugin.installed).length
  const statusCounts: Record<StatusFilter, number> = {
    all: catalog.length,
    available: catalog.length - installed,
    disabled: catalog.filter(plugin => plugin.installed && !plugin.enabled).length,
    installed,
    updates: catalog.filter(plugin => plugin.updateAvailable).length,
  }
  const categories = [...new Set(catalog.map(plugin => plugin.category))].sort()
  const needle = filters.search.trim().toLowerCase()
  const filtered = catalog.filter(plugin => {
    if (filters.statusFilter === 'installed' && !plugin.installed) return false
    if (filters.statusFilter === 'available' && plugin.installed) return false
    if (filters.statusFilter === 'updates' && !plugin.updateAvailable) return false
    if (filters.statusFilter === 'disabled' && (!plugin.installed || plugin.enabled)) return false
    if (filters.categoryFilter !== 'all' && plugin.category !== filters.categoryFilter) return false
    if (needle === '') return true
    return [plugin.title, localizedDescription(plugin, 'en'), localizedDescription(plugin, 'zh'), plugin.category, ...plugin.tags]
      .some(value => value.toLowerCase().includes(needle))
  })
  return {
    categories,
    plugins: sortMarketplacePlugins(filtered, filters.sort),
    statusCounts,
    watchlist: snapshot?.catalogWatchlist ?? [],
  }
}

const CARD_MIN_WIDTH = 240
const CARD_GAP = 8
const CARD_HEIGHT = 132
const ROW_HEIGHT = CARD_HEIGHT + CARD_GAP

function VirtualCardGrid({ plugins, selectedId, onSelect, t, locale }: { plugins: MarketplacePlugin[]; selectedId: string | null; onSelect(id: string): void; t: Translate<MarketplaceMessage>; locale: string }): JSX.Element {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const resolveScrollElement = useCallback((node: HTMLDivElement | null): void => {
    setScrollElement(resolveMarketplaceScrollViewport(node))
  }, [])
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (scrollElement === null) return
    setWidth(scrollElement.clientWidth)
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry !== undefined) setWidth(entry.contentRect.width)
    })
    observer.observe(scrollElement)
    return () => { observer.disconnect() }
  }, [scrollElement])
  const columns = Math.max(1, Math.floor((width + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)))
  const rowCount = Math.ceil(plugins.length / columns)
  const virtualizer = useVirtualizer({ count: rowCount, getScrollElement: () => scrollElement, estimateSize: () => ROW_HEIGHT, overscan: 3, getItemKey: index => plugins[index * columns]?.id ?? index })
  useEffect(() => { virtualizer.measure() }, [scrollElement, virtualizer])
  return (
    <ScrollArea ref={resolveScrollElement} className="oh-marketplace-main" viewportClassName="dsh-studio-ui-scroll-viewport-inset">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map(virtualRow => {
          const rowPlugins = plugins.slice(virtualRow.index * columns, virtualRow.index * columns + columns)
          return (
            <div key={virtualRow.key} className="oh-marketplace-grid" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: CARD_HEIGHT, transform: `translateY(${String(virtualRow.start)}px)`, gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))` }}>
              {rowPlugins.map(plugin => <PluginCard key={plugin.id} plugin={plugin} selected={selectedId === plugin.id} select={() => { onSelect(plugin.id) }} t={t} locale={locale} />)}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

const STATUS_TABS = [
  ['all', 'all'], ['installed', 'installed'], ['available', 'not-installed'], ['updates', 'updates'], ['disabled', 'disabled'],
] as const

export function MarketplaceToolbar({ t, pending, filters, categories, statusCounts, onDirectSubmit }: { t: Translate<MarketplaceMessage>; pending: boolean; filters: MarketplaceFilters; categories: readonly string[]; statusCounts: Record<StatusFilter, number>; onDirectSubmit(): void }): JSX.Element {
  return (
    <div className="oh-marketplace-toolbar">
      <div className="oh-marketplace-search">
        <Input icon={<IconSearch size={16} />} aria-label={t('search.label')} onChange={event => { filters.setSearch(event.target.value) }} placeholder={t('search.placeholder')} value={filters.search} />
        {filters.search !== '' && <ToolbarAction label={t('search.clear')} icon={<IconClose size={14} />} onClick={() => { filters.setSearch('') }} />}
      </div>
      <div className="oh-marketplace-direct-source">
        <Input aria-label={t('direct-source.label')} onChange={event => { filters.setRepositoryInput(event.target.value) }} placeholder={t('direct-source.placeholder')} value={filters.repositoryInput} />
        <Button disabled={pending || filters.repositoryInput.trim() === ''} onClick={onDirectSubmit} size="sm" variant="outline">{t('direct-source.submit')}</Button>
      </div>
      <fieldset className="oh-marketplace-status-tabs">
        <legend className="oh-marketplace-visually-hidden">{t('installation-status')}</legend>
        {STATUS_TABS.map(([value, labelKey]) => <Pill active={filters.statusFilter === value} key={value} onClick={() => { filters.setStatusFilter(value) }}>{t(labelKey)}<span>{statusCounts[value]}</span></Pill>)}
      </fieldset>
      <CategoryMenu categories={categories} value={filters.categoryFilter} t={t} onChange={filters.setCategoryFilter} />
      <SortMenu value={filters.sort} t={t} onChange={filters.setSort} />
    </div>
  )
}

function asDirectPlugin(snapshot: MarketplaceSnapshot | null): MarketplacePlugin | null {
  const candidate = snapshot?.candidate
  if (candidate === null || candidate === undefined) return null
  return {
    catalogSourceId: candidate.source.catalogSourceId,
    category: 'direct-repository', compatibility: { status: 'unknown', dshVersion: null, lastVerified: null, note: null }, currentCommit: null,
    description: candidate.description, descriptionByLocale: { en: candidate.description, zh: candidate.description }, downloads: null, enabled: false,
    evidenceLevel: null, homepage: candidate.evidence.metadata?.homepage ?? null, id: candidate.identity.pluginId, installed: false, installCommand: candidate.source.installSpec,
    latestCommit: candidate.source.resolvedCommit, mechanism: candidate.mechanism, npm: candidate.identity.packageName, officialBeta: false,
    preferredChannel: candidate.source.channel, protected: false, pushedAt: null, readmeSummary: null, releaseAssetDigest: null, releaseAssetUrl: candidate.source.artifactUrl,
    repository: candidate.identity.repository, runtimeRisk: candidate.mechanism === 'bundle' ? 'profile-bundle' : 'guided', score: null, scoreExplanation: null, screenshots: [], sourceNote: null,
    stars: 0, tags: candidate.evidence.metadata?.keywords ?? [], title: candidate.evidence.metadata?.displayName ?? candidate.identity.packageName ?? candidate.identity.pluginId, trust: 'untrusted', updateAvailable: false,
    url: candidate.source.locator, version: candidate.source.version, watchReason: null, weeklyGrowth: null,
  }
}

function InputRequestPanel({ request, pending, t, run }: { request: NonNullable<MarketplaceSnapshot['inputRequest']>; pending: boolean; t: Translate<MarketplaceMessage>; run(command: MarketplaceCommand): Promise<void> }): JSX.Element {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  return (
    <section className="oh-marketplace-input-request" aria-live="polite">
      <h3>{t('configuration-required')}</h3>
      {request.requirements.map(requirement => (
        <label key={requirement.name} htmlFor={`marketplace-material-global-${requirement.name}`}>
          <span>{requirement.name}</span>
          <Input
            id={`marketplace-material-global-${requirement.name}`}
            type={requirement.secret ? 'password' : 'text'}
            value={answers[requirement.name] ?? ''}
            placeholder={requirement.description}
            onChange={event => { setAnswers(current => ({ ...current, [requirement.name]: event.target.value })) }}
          />
        </label>
      ))}
      <Button
        variant="primary"
        size="sm"
        disabled={pending || request.requirements.some(requirement => (answers[requirement.name] ?? '').trim() === '')}
        onClick={() => { void run({ type: 'provide', transactionId: request.transactionId, answers }) }}
      >
        {t('continue-install')}
      </Button>
    </section>
  )
}

function ProgressPanel({ snapshot, t, run }: { snapshot: MarketplaceSnapshot | null; t: Translate<MarketplaceMessage>; run(command: MarketplaceCommand): Promise<void> }): JSX.Element | null {
  const progress = snapshot?.progress
  if (progress == null) return null
  return (
    <section className="oh-marketplace-progress" aria-live="polite">
      <div className="oh-marketplace-progress-heading"><strong>{t(`progress.${progress.stage}`)}</strong><span>{progress.percent === null ? t('progress.in-progress') : `${String(progress.percent)}%`}</span></div>
      <div className="oh-marketplace-progress-track"><span style={{ width: progress.percent === null ? '35%' : `${String(progress.percent)}%` }} /></div>
      <div className="oh-marketplace-progress-meta"><span>{progress.etaSeconds === null ? '' : t('progress.eta', { seconds: progress.etaSeconds })}</span>{progress.cancelable && <Button variant="outline" size="sm" onClick={() => { void run({ type: 'cancel', transactionId: progress.transactionId }) }}>{t('cancel')}</Button>}</div>
      {progress.logTail.length > 0 && <pre>{progress.logTail.join('\n')}</pre>}
    </section>
  )
}

function Watchlist({ plugins, t, locale, select }: { plugins: MarketplacePlugin[]; t: Translate<MarketplaceMessage>; locale: string; select(id: string): void }): JSX.Element | null {
  if (plugins.length === 0) return null
  return (
    <details className="oh-marketplace-watchlist">
      <summary>{t('watchlist', { count: plugins.length })}</summary>
      <div>{plugins.slice(0, 24).map(plugin => <button key={plugin.id} type="button" onClick={() => { select(plugin.id) }}><strong>{plugin.title}</strong><span>{localizedDescription(plugin, locale)} · {plugin.watchReason ?? t('watchlist-review')}</span></button>)}</div>
    </details>
  )
}

export function MarketplaceModal({ t, locale, open, initialPluginId, onClose, bridge, data, run }: { t: Translate<MarketplaceMessage>; locale: LocaleService; open: boolean; initialPluginId?: string | null; onClose(): void; bridge: DesktopBridge; data: { snapshot: MarketplaceSnapshot | null; busy: boolean; localError: string | null }; run(command: MarketplaceCommand): Promise<MarketplaceDispatchOutcome> }): JSX.Element {
  const filters = useMarketplaceFilters()
  const viewMeta = useMemo(() => deriveMarketplaceCatalog(data.snapshot, filters), [data.snapshot, filters])
  const error = data.localError ?? data.snapshot?.error ?? null
  const loadedNotice = marketplaceLoadedNotice(data.snapshot, t)
  const actionNotice = marketplaceActionNotice(data.snapshot, error, t)
  const directPlugin = useMemo(() => asDirectPlugin(data.snapshot), [data.snapshot])
  const selected = viewMeta.plugins.find(plugin => plugin.id === filters.selectedId) ?? viewMeta.watchlist.find(plugin => plugin.id === filters.selectedId) ?? (directPlugin?.id === filters.selectedId ? directPlugin : null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [applyAcknowledged, setApplyAcknowledged] = useState(false)

  useEffect(() => {
    if (initialPluginId !== null && initialPluginId !== undefined) {
      filters.setSelectedId(initialPluginId)
    } else if (filters.selectedId === null && viewMeta.plugins[0] !== undefined) {
      filters.setSelectedId(viewMeta.plugins[0].id)
    }
  }, [filters, initialPluginId, viewMeta.plugins])

  const runCommand = useCallback(async (command: MarketplaceCommand): Promise<MarketplaceDispatchOutcome> => {
    const announce = (completed: MarketplaceDispatchOutcome, notify: boolean): MarketplaceDispatchOutcome => {
      if (notify && completed.rejected === null && completed.snapshot?.error === null && completed.snapshot.lastAction !== null && completed.snapshot.lastAction !== undefined) {
        toast(localizedHostMessage(completed.snapshot.lastAction, t))
      }
      return completed
    }
    const outcome = await run(command)
    if (command.type === 'plan' && outcome.snapshot?.plan !== null && outcome.snapshot?.plan !== undefined) {
      filters.setSelectedId(outcome.snapshot.plan.pluginId)
      const plan = outcome.snapshot.plan
      if (plan.fastPathEligible && plan.requirements.length === 0 && plan.environmentRequirements.length === 0) {
        return announce(await run({ type: 'execute', action: plan.action, mode: 'direct', pluginId: plan.pluginId, confirmations: [] }), true)
      }
    }
    return announce(outcome, command.type !== 'refresh' && command.type !== 'plan')
  }, [filters, run, t])

  const planRepository = (): void => {
    const input = filters.repositoryInput.trim()
    if (input === '') return
    void runCommand({ type: 'plan', action: 'install', sourceRef: { input, kind: 'repository' } })
  }

  const updateAll = async (): Promise<void> => {
    for (const plugin of data.snapshot?.catalog.filter(item => item.updateAvailable) ?? []) {
      const outcome = await runCommand({ type: 'plan', action: 'update', pluginId: plugin.id })
      const plan = outcome.snapshot?.plan
      if (plan !== null && plan !== undefined && plan.fastPathEligible && plan.requirements.length === 0 && plan.environmentRequirements.length === 0) {
        await runCommand({ type: 'execute', action: 'update', mode: 'direct', pluginId: plugin.id, confirmations: [] })
      }
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('plugins')} description={loadedNotice === null ? t('subtitle') : `${t('subtitle')} ${loadedNotice}`} closeLabel={t('close')} className="oh-marketplace-shell" contentClassName="oh-marketplace-shell-content" footer={(
      <div className="oh-marketplace-shell-footer"><span className="oh-marketplace-count">{t('plugin-count', { count: viewMeta.plugins.length })}</span><Button variant="outline" size="sm" disabled={data.busy} onClick={() => { void updateAll() }}>{t('update-all')}</Button>{data.snapshot?.undoAvailable === true && <Button variant="outline" size="sm" disabled={data.busy} onClick={() => { void runCommand({ type: 'undo' }) }}>{t('undo-last-apply')}</Button>}<Button variant="outline" size="sm" disabled={data.busy} onClick={() => { void runCommand({ type: 'refresh', force: true }) }}>{data.busy ? t('working') : t('refresh')}</Button></div>
    )}>
      <div className="oh-marketplace-app">
        {data.snapshot?.selfUpdate?.updateAvailable === true && <div className="oh-marketplace-self-update"><span>{t('self-update', { version: data.snapshot.selfUpdate.latestVersion ?? '' })}</span><Button variant="outline" size="sm" onClick={() => { void runCommand({ type: 'plan', action: 'update', pluginId: 'plugin-marketplace' }) }}>{t('update-now')}</Button></div>}
        {data.snapshot?.preview !== null && data.snapshot?.preview !== undefined && <div className="oh-marketplace-preview-banner"><strong>{t('preview.running', { plugin: data.snapshot.preview.packId ?? data.snapshot.preview.pluginId })}</strong><Button variant="outline" size="sm" disabled={data.busy} onClick={() => { void runCommand({ type: 'discard' }) }}>{t('discard')}</Button><Button variant="primary" size="sm" disabled={data.busy} onClick={() => { setApplyAcknowledged(false); setApplyOpen(true) }}>{t('apply-action', { action: t(`action.${data.snapshot.preview.action}`) })}</Button></div>}
        {error !== null && <Alert variant="destructive" className="oh-marketplace-error"><AlertDescription>{error}</AlertDescription><AlertAction><Button variant="outline" size="sm" disabled={data.busy} onClick={() => { filters.reset(); void runCommand({ type: 'refresh', force: true }) }}>{t('reset-and-reload')}</Button></AlertAction></Alert>}
        {actionNotice !== null && <div className="oh-marketplace-notice">{actionNotice}</div>}
        <ProgressPanel snapshot={data.snapshot} t={t} run={async command => { await runCommand(command) }} />
        {data.snapshot?.inputRequest !== null && data.snapshot?.inputRequest !== undefined && (selected === null || selected.id !== data.snapshot.inputRequest.pluginId) && <InputRequestPanel request={data.snapshot.inputRequest} pending={data.busy} t={t} run={async command => { await runCommand(command) }} />}
        <div className="oh-marketplace-workspace">
          <section className="oh-marketplace-results">
            <MarketplaceToolbar t={t} pending={data.busy} filters={filters} categories={viewMeta.categories} statusCounts={viewMeta.statusCounts} onDirectSubmit={planRepository} />
            {data.snapshot?.candidate !== null && data.snapshot?.candidate !== undefined && <button className="oh-marketplace-direct-candidate" type="button" onClick={() => { filters.setSelectedId(data.snapshot?.candidate?.identity.pluginId ?? null) }}><strong>{data.snapshot.candidate.evidence.metadata?.displayName ?? data.snapshot.candidate.identity.packageName}</strong><span>{data.snapshot.candidate.source.installSpec}</span><span>{data.snapshot.candidate.execution}</span></button>}
            {data.snapshot === null || data.busy && data.snapshot.catalog.length === 0 ? <LoadingState className="oh-marketplace-empty" label={t('loading-catalog')} /> : data.snapshot.auth.status !== 'ready' && data.snapshot.catalog.length === 0 ? <EmptyState layout="centered" className="oh-marketplace-empty" title={t('github-auth-required')} description={localizedAuthDetail(data.snapshot.auth.detail, t)} /> : viewMeta.plugins.length === 0 ? <EmptyState layout="centered" className="oh-marketplace-empty" title={t('no-match')} /> : <VirtualCardGrid plugins={viewMeta.plugins} selectedId={filters.selectedId} onSelect={filters.setSelectedId} t={t} locale={localeTag(locale)} />}
            <Watchlist plugins={viewMeta.watchlist} t={t} locale={localeTag(locale)} select={filters.setSelectedId} />
            {data.snapshot !== null && data.snapshot.packs.length > 0 && <section className="oh-marketplace-packs"><h3>{t('packs')}</h3>{data.snapshot.packs.map(pack => <div key={pack.id}><strong>{pack.title}</strong><span>{pack.description}</span><Button variant="outline" size="sm" disabled={data.busy} onClick={() => { void runCommand({ type: 'pack', packId: pack.id, mode: 'direct', confirmations: [] }) }}>{t('install-pack')}</Button></div>)}</section>}
          </section>
          <section className="oh-marketplace-detail-region">{selected !== null && data.snapshot !== null ? <PluginDetail bridge={bridge} pending={data.busy} plugin={selected} snapshot={data.snapshot} locale={locale} t={t} close={() => { filters.setSelectedId(null) }} run={async command => { await runCommand(command) }} /> : <EmptyState layout="centered" className="oh-marketplace-empty" title={t('select-plugin')} description={t('select-plugin-description')} />}</section>
        </div>
      </div>
      {data.snapshot?.preview !== null && data.snapshot?.preview !== undefined && <RiskConfirmation open={applyOpen} title={t('apply-action', { action: t(`action.${data.snapshot.preview.action}`) })} description={t('recovery-note')} acknowledgeLabel={t('apply-acknowledge')} cancelLabel={t('cancel')} confirmLabel={t('apply-to-desktop')} acknowledged={applyAcknowledged} disabled={data.busy} onAcknowledgedChange={setApplyAcknowledged} onCancel={() => { setApplyOpen(false) }} onConfirm={() => { setApplyOpen(false); void runCommand({ type: 'apply' }) }} />}
    </Modal>
  )
}

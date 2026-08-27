import { useCallback, useEffect, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button, Input, Modal, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import { Alert, AlertAction, AlertDescription, EmptyState, LoadingState, ScrollArea, ToolbarAction } from '@dsh-studio/shared/ui'
import { toast } from '@dsh-studio/shared/toast'
import { localeTag, type LocaleService, type Translate } from '@dsh-studio/shared/i18n'
import { IconAdjustments, IconClose, IconGitBranch, IconRefresh, IconSearch } from '@dsh-studio/shared/tabler-icons'
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

export function marketplaceFilterCount(filters: MarketplaceFilters): number {
  return (filters.statusFilter === 'all' ? 0 : 1)
    + (filters.categoryFilter === 'all' ? 0 : 1)
}

const STATUS_FILTERS = [
  ['all', 'all'],
  ['available', 'not-installed'],
  ['installed', 'installed'],
  ['updates', 'updates'],
  ['disabled', 'disabled'],
] as const satisfies readonly [StatusFilter, MarketplaceMessage][]

export function MarketplaceToolbar({
  t,
  pending,
  filters,
  filterCount,
  filterOpen,
  sourceOpen,
  onToggleFilters,
  onToggleSource,
  onRefresh,
}: {
  t: Translate<MarketplaceMessage>
  pending: boolean
  filters: MarketplaceFilters
  filterCount: number
  filterOpen: boolean
  sourceOpen: boolean
  onToggleFilters(): void
  onToggleSource(): void
  onRefresh(): void
}): JSX.Element {
  return (
    <header className="oh-marketplace-toolbar">
      <div className="oh-marketplace-search">
        <Input icon={<IconSearch size={16} />} aria-label={t('search.label')} onChange={event => { filters.setSearch(event.target.value) }} placeholder={t('search.placeholder')} value={filters.search} />
        {filters.search !== '' && <ToolbarAction label={t('search.clear')} icon={<IconClose size={14} />} onClick={() => { filters.setSearch('') }} />}
      </div>
      <div className="oh-marketplace-toolbar-actions">
        <Button
          aria-expanded={filterOpen}
          aria-haspopup="menu"
          className="oh-marketplace-filter-trigger"
          icon={<IconAdjustments size={15} />}
          onClick={onToggleFilters}
          size="sm"
          variant={filterOpen || filterCount > 0 ? 'outline' : 'ghost'}
        >
          {t('filter')}{filterCount > 0 && <span className="oh-marketplace-filter-count">{filterCount}</span>}
        </Button>
        <Button
          aria-expanded={sourceOpen}
          aria-controls="marketplace-repository-panel"
          className="oh-marketplace-secondary-trigger"
          icon={<IconGitBranch size={15} />}
          onClick={onToggleSource}
          size="sm"
          variant="ghost"
        >
          {t('install-from-repository')}
        </Button>
        <ToolbarAction disabled={pending} label={pending ? t('working') : t('refresh')} icon={<IconRefresh size={15} />} onClick={onRefresh} />
      </div>
    </header>
  )
}

function FilterPanel({
  t,
  filters,
  categories,
  statusCounts,
  onClear,
}: {
  t: Translate<MarketplaceMessage>
  filters: MarketplaceFilters
  categories: readonly string[]
  statusCounts: Record<StatusFilter, number>
  onClear(): void
}): JSX.Element {
  const filterCount = marketplaceFilterCount(filters)
  return (
    <section aria-label={t('filter')} className="oh-marketplace-filter-panel">
      <div className="oh-marketplace-filter-group">
        <span className="oh-marketplace-filter-label">{t('installation-status')}</span>
        <div className="oh-marketplace-filter-options">
          {STATUS_FILTERS.map(([value, label]) => (
            <Button
              aria-pressed={filters.statusFilter === value}
              className="oh-marketplace-filter-option"
              data-active={String(filters.statusFilter === value)}
              key={value}
              onClick={() => { filters.setStatusFilter(value) }}
              size="sm"
              variant={filters.statusFilter === value ? 'outline' : 'ghost'}
            >
              {t(label)} <span>{statusCounts[value]}</span>
            </Button>
          ))}
        </div>
      </div>
      <div className="oh-marketplace-filter-group oh-marketplace-filter-menus">
        <span className="oh-marketplace-filter-label">{t('refine-results')}</span>
        <CategoryMenu categories={categories} value={filters.categoryFilter} t={t} onChange={filters.setCategoryFilter} />
        <SortMenu value={filters.sort} t={t} onChange={filters.setSort} />
        {filterCount > 0 && <Button onClick={onClear} size="sm" variant="ghost">{t('clear-filters')}</Button>}
      </div>
    </section>
  )
}

function RepositoryPanel({ filters, pending, t, onSubmit }: { filters: MarketplaceFilters; pending: boolean; t: Translate<MarketplaceMessage>; onSubmit(): void }): JSX.Element {
  return (
    <section aria-label={t('install-from-repository')} className="oh-marketplace-repository-panel" id="marketplace-repository-panel">
      <div>
        <strong>{t('install-from-repository')}</strong>
        <p>{t('repository-help')}</p>
      </div>
      <div className="oh-marketplace-repository-form">
        <Input aria-label={t('direct-source.label')} onChange={event => { filters.setRepositoryInput(event.target.value) }} placeholder={t('direct-source.placeholder')} value={filters.repositoryInput} />
        <Button disabled={pending || filters.repositoryInput.trim() === ''} onClick={onSubmit} size="sm" variant="outline">{t('direct-source.submit')}</Button>
      </div>
    </section>
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
      <div>
        <strong>{t('configuration-required')}</strong>
        <p>{t('configuration-help')}</p>
      </div>
      <div className="oh-marketplace-input-fields">
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
      </div>
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

function PluginList({ plugins, selectedId, onSelect, t, locale }: { plugins: MarketplacePlugin[]; selectedId: string | null; onSelect(id: string): void; t: Translate<MarketplaceMessage>; locale: string }): JSX.Element {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const resolveScrollElement = useCallback((node: HTMLDivElement | null): void => {
    setScrollElement(resolveMarketplaceScrollViewport(node))
  }, [])
  const selectedIndex = plugins.findIndex(plugin => plugin.id === selectedId)
  const virtualizer = useVirtualizer({
    count: plugins.length,
    getItemKey: index => plugins[index]?.id ?? index,
    getScrollElement: () => scrollElement,
    estimateSize: () => 72,
    measureElement: element => element.getBoundingClientRect().height,
    overscan: 8,
  })
  useEffect(() => { virtualizer.measure() }, [plugins, scrollElement, virtualizer])
  const move = (index: number, direction: 'next' | 'previous' | 'first' | 'last'): void => {
    if (plugins.length === 0) return
    const target = direction === 'next'
      ? Math.min(plugins.length - 1, index + 1)
      : direction === 'previous'
        ? Math.max(0, index - 1)
        : direction === 'first' ? 0 : plugins.length - 1
    const plugin = plugins[target]
    if (plugin !== undefined) {
      onSelect(plugin.id)
      virtualizer.scrollToIndex(target, { align: 'auto' })
    }
  }
  return (
    <ScrollArea ref={resolveScrollElement} className="oh-marketplace-main" viewportClassName="dsh-studio-ui-scroll-viewport-inset">
      <div aria-label={t('plugin-results')} className="oh-marketplace-list" role="listbox" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(virtualItem => {
          const plugin = plugins[virtualItem.index]
          if (plugin === undefined) return null
          return (
            <div
              className="oh-marketplace-list-item"
              data-index={virtualItem.index}
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${String(virtualItem.start)}px)` }}
            >
              <PluginCard
                locale={locale}
                move={direction => { move(virtualItem.index, direction) }}
                plugin={plugin}
                select={() => { onSelect(plugin.id) }}
                selected={selectedId === plugin.id}
                tabIndex={selectedId === null ? virtualItem.index === 0 ? 0 : -1 : selectedIndex === virtualItem.index ? 0 : -1}
                t={t}
              />
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

function MarketplaceExtras({ snapshot, watchlist, t, locale, select, pending, run, onUpdateAll }: { snapshot: MarketplaceSnapshot | null; watchlist: MarketplacePlugin[]; t: Translate<MarketplaceMessage>; locale: string; select(id: string): void; pending: boolean; run(command: MarketplaceCommand): Promise<void>; onUpdateAll(): void }): JSX.Element | null {
  const updates = snapshot?.catalog.filter(plugin => plugin.updateAvailable) ?? []
  if (watchlist.length === 0 && updates.length === 0 && (snapshot?.packs.length ?? 0) === 0) return null
  return (
    <details className="oh-marketplace-extras">
      <summary><span>{t('more')}</span><span>{t('more-count', { count: watchlist.length + updates.length + (snapshot?.packs.length ?? 0) })}</span></summary>
      <div className="oh-marketplace-extras-content">
        {updates.length > 0 && <section className="oh-marketplace-extra-section"><div><strong>{t('updates')}</strong><p>{t('updates-help', { count: updates.length })}</p></div><Button disabled={pending} onClick={onUpdateAll} size="sm" variant="outline">{t('update-all')}</Button></section>}
        {watchlist.length > 0 && <section className="oh-marketplace-extra-section"><strong>{t('watchlist', { count: watchlist.length })}</strong><div className="oh-marketplace-watchlist-list">{watchlist.slice(0, 24).map(plugin => <button key={plugin.id} type="button" onClick={() => { select(plugin.id) }}><span>{plugin.title}</span><small>{localizedDescription(plugin, locale)} · {plugin.watchReason ?? t('watchlist-review')}</small></button>)}</div></section>}
        {(snapshot?.packs.length ?? 0) > 0 && <section className="oh-marketplace-extra-section"><strong>{t('packs')}</strong>{snapshot?.packs.map(pack => <div className="oh-marketplace-pack-row" key={pack.id}><div><span>{pack.title}</span><small>{pack.description}</small></div><Button variant="outline" size="sm" disabled={pending} onClick={() => { void run({ type: 'pack', packId: pack.id, mode: 'direct', confirmations: [] }) }}>{t('install-pack')}</Button></div>)}</section>}
      </div>
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
  const selected = data.snapshot?.catalog.find(plugin => plugin.id === filters.selectedId)
    ?? viewMeta.watchlist.find(plugin => plugin.id === filters.selectedId)
    ?? (directPlugin?.id === filters.selectedId ? directPlugin : null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [applyAcknowledged, setApplyAcknowledged] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [mobileView, setMobileView] = useState<'browse' | 'detail'>('browse')
  const filterCount = marketplaceFilterCount(filters)
  const selectPlugin = useCallback((id: string): void => {
    filters.setSelectedId(id)
    setMobileView('detail')
  }, [filters.setSelectedId])
  const clearSelection = useCallback((): void => {
    filters.setSelectedId(null)
    setMobileView('browse')
  }, [filters.setSelectedId])

  useEffect(() => {
    if (initialPluginId !== null && initialPluginId !== undefined) {
      filters.setSelectedId(initialPluginId)
      setMobileView('detail')
    } else if (filters.selectedId === null && viewMeta.plugins[0] !== undefined) {
      filters.setSelectedId(viewMeta.plugins[0].id)
    }
  }, [filters.selectedId, filters.setSelectedId, initialPluginId, viewMeta.plugins])

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
      setMobileView('detail')
    }
    return announce(outcome, command.type !== 'refresh' && command.type !== 'plan')
  }, [filters.setSelectedId, run, t])

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
    <Modal open={open} onClose={onClose} title={t('plugins')} description={loadedNotice === null ? t('subtitle') : `${t('subtitle')} ${loadedNotice}`} closeLabel={t('close')} className="oh-marketplace-shell" contentClassName="oh-marketplace-shell-content">
      <div className="oh-marketplace-app">
        {data.snapshot?.selfUpdate?.updateAvailable === true && <div className="oh-marketplace-self-update"><span>{t('self-update', { version: data.snapshot.selfUpdate.latestVersion ?? '' })}</span><Button variant="outline" size="sm" onClick={() => { void runCommand({ type: 'plan', action: 'update', pluginId: 'plugin-marketplace' }) }}>{t('update-now')}</Button></div>}
        {data.snapshot?.preview !== null && data.snapshot?.preview !== undefined && <div className="oh-marketplace-preview-banner"><strong>{t('preview.running', { plugin: data.snapshot.preview.packId ?? data.snapshot.preview.pluginId })}</strong><Button variant="outline" size="sm" disabled={data.busy} onClick={() => { void runCommand({ type: 'discard' }) }}>{t('discard')}</Button><Button variant="primary" size="sm" disabled={data.busy} onClick={() => { setApplyAcknowledged(false); setApplyOpen(true) }}>{t('apply-action', { action: t(`action.${data.snapshot.preview.action}`) })}</Button></div>}
        {error !== null && <Alert variant="destructive" className="oh-marketplace-error"><AlertDescription>{error}</AlertDescription><AlertAction><Button variant="outline" size="sm" disabled={data.busy} onClick={() => { filters.reset(); void runCommand({ type: 'refresh', force: true }) }}>{t('reset-and-reload')}</Button></AlertAction></Alert>}
        {actionNotice !== null && <div className="oh-marketplace-notice"><span>{actionNotice}</span>{data.snapshot?.undoAvailable === true && <Button variant="outline" size="sm" disabled={data.busy} onClick={() => { void runCommand({ type: 'undo' }) }}>{t('undo-last-apply')}</Button>}</div>}
        <ProgressPanel snapshot={data.snapshot} t={t} run={async command => { await runCommand(command) }} />
        {data.snapshot?.inputRequest !== null && data.snapshot?.inputRequest !== undefined && (selected === null || selected.id !== data.snapshot.inputRequest.pluginId) && <InputRequestPanel request={data.snapshot.inputRequest} pending={data.busy} t={t} run={async command => { await runCommand(command) }} />}
        <MarketplaceToolbar filterCount={filterCount} filterOpen={filterOpen} onRefresh={() => { void runCommand({ type: 'refresh', force: true }) }} onToggleFilters={() => { setFilterOpen(current => !current); setSourceOpen(false) }} onToggleSource={() => { setSourceOpen(current => !current); setFilterOpen(false) }} pending={data.busy} sourceOpen={sourceOpen} t={t} filters={filters} />
        {filterOpen && <FilterPanel categories={viewMeta.categories} filters={filters} onClear={() => { filters.setStatusFilter('all'); filters.setCategoryFilter('all') }} statusCounts={viewMeta.statusCounts} t={t} />}
        {sourceOpen && <RepositoryPanel filters={filters} onSubmit={planRepository} pending={data.busy} t={t} />}
        <div className="oh-marketplace-workspace" data-mobile-view={mobileView}>
          <section className="oh-marketplace-results">
            <div className="oh-marketplace-results-header"><strong>{t('plugin-count', { count: viewMeta.plugins.length })}</strong><span>{t('sorted-by', { sort: t(`sort.${filters.sort}`) })}</span></div>
            {data.snapshot === null || data.busy && data.snapshot.catalog.length === 0 ? <LoadingState className="oh-marketplace-empty" label={t('loading-catalog')} /> : data.snapshot.auth.status !== 'ready' && data.snapshot.catalog.length === 0 ? <EmptyState layout="centered" className="oh-marketplace-empty" title={t('github-auth-required')} description={localizedAuthDetail(data.snapshot.auth.detail, t)} /> : viewMeta.plugins.length === 0 ? <EmptyState layout="centered" className="oh-marketplace-empty" title={t('no-match')} /> : <PluginList locale={localeTag(locale)} onSelect={selectPlugin} plugins={viewMeta.plugins} selectedId={filters.selectedId} t={t} />}
            <MarketplaceExtras locale={localeTag(locale)} onUpdateAll={() => { void updateAll() }} pending={data.busy} run={async command => { await runCommand(command) }} select={selectPlugin} snapshot={data.snapshot} t={t} watchlist={viewMeta.watchlist} />
          </section>
          <section className="oh-marketplace-detail-region">{selected !== null && data.snapshot !== null ? <PluginDetail bridge={bridge} pending={data.busy} plugin={selected} snapshot={data.snapshot} locale={locale} t={t} close={clearSelection} run={async command => { await runCommand(command) }} /> : <EmptyState layout="centered" className="oh-marketplace-empty" title={t('select-plugin')} description={t('select-plugin-description')} />}</section>
        </div>
        {data.snapshot?.preview !== null && data.snapshot?.preview !== undefined && <RiskConfirmation open={applyOpen} title={t('apply-action', { action: t(`action.${data.snapshot.preview.action}`) })} description={t('recovery-note')} acknowledgeLabel={t('apply-acknowledge')} cancelLabel={t('cancel')} confirmLabel={t('apply-to-desktop')} acknowledged={applyAcknowledged} disabled={data.busy} onAcknowledgedChange={setApplyAcknowledged} onCancel={() => { setApplyOpen(false) }} onConfirm={() => { setApplyOpen(false); void runCommand({ type: 'apply' }) }} />}
      </div>
    </Modal>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Button, Input, Modal, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import { Alert, AlertAction, AlertDescription, EmptyState, LoadingState, ScrollArea, ToolbarAction } from '@dsh-studio/shared/ui'
import { toast } from '@dsh-studio/shared/toast'
import { localeTag, type LocaleService, type Translate } from '@dsh-studio/shared/i18n'
import {
  IconApps,
  IconClose,
  IconDownload,
  IconGitBranch,
  IconRefresh,
  IconRotate,
  IconSearch,
} from '@dsh-studio/shared/tabler-icons'
import type { DesktopBridge } from '@dsh-studio/shared/desktop-contracts'
import type { MarketplaceCommand, MarketplacePlugin, MarketplaceSnapshot, MarketplaceSort } from '../protocol.ts'
import type { MarketplaceMessage } from './i18n.ts'
import { getCategoryIcon, PluginCard, SortMenu } from './marketplace-browse.tsx'
import { PluginDetail } from './plugin-detail.tsx'
import { resolveMarketplaceScrollViewport } from './marketplace-dom.ts'
import { localizedHostMessage, marketplaceActionNotice, localizedAuthDetail, marketplaceLoadedNotice } from './marketplace-notices.ts'
import type { MarketplaceDispatchOutcome } from './store.ts'
import { localizedDescription, sortMarketplacePlugins } from './marketplace-meta.ts'
import { MarketplaceCss as css } from './styles.js'

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

function PluginGridList({
  plugins,
  selectedId,
  onSelect,
  t,
  locale,
}: {
  plugins: MarketplacePlugin[]
  selectedId: string | null
  onSelect(id: string): void
  t: Translate<MarketplaceMessage>
  locale: string
}): JSX.Element {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const resolveScrollElement = useCallback((node: HTMLDivElement | null): void => {
    setScrollElement(resolveMarketplaceScrollViewport(node))
  }, [])

  // Virtualize rows of 2 plugins per row
  const rowCount = Math.ceil(plugins.length / 2)
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElement,
    estimateSize: () => 110,
    overscan: 4,
  })

  useEffect(() => { virtualizer.measure() }, [plugins, scrollElement, virtualizer])

  return (
    <ScrollArea ref={resolveScrollElement} className={css.gridScroll}>
      <div aria-label={t('plugin-results')} className={css.gridContainer} role="grid" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(virtualRow => {
          const firstIndex = virtualRow.index * 2
          const p1 = plugins[firstIndex]
          const p2 = plugins[firstIndex + 1]
          if (!p1) return null

          return (
            <div
              className={css.gridRow}
              key={virtualRow.key}
              role="row"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <PluginCard
                locale={locale}
                move={() => {}}
                plugin={p1}
                select={() => { onSelect(p1.id) }}
                selected={selectedId === p1.id}
                tabIndex={0}
                t={t}
              />
              {p2 ? (
                <PluginCard
                  locale={locale}
                  move={() => {}}
                  plugin={p2}
                  select={() => { onSelect(p2.id) }}
                  selected={selectedId === p2.id}
                  tabIndex={0}
                  t={t}
                />
              ) : (
                <div style={{ flex: '1 1 0', width: 0, visibility: 'hidden' }} />
              )}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

export function MarketplaceModal({
  t,
  locale,
  open,
  initialPluginId,
  onClose,
  bridge,
  data,
  run,
}: {
  t: Translate<MarketplaceMessage>
  locale: LocaleService
  open: boolean
  initialPluginId?: string | null
  onClose(): void
  bridge: DesktopBridge
  data: { snapshot: MarketplaceSnapshot | null; busy: boolean; localError: string | null }
  run(command: MarketplaceCommand): Promise<MarketplaceDispatchOutcome>
}): JSX.Element {
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
  const [installModalOpen, setInstallModalOpen] = useState(false)
  const [mobileView, setMobileView] = useState<'browse' | 'detail'>('browse')

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
    setInstallModalOpen(false)
    void runCommand({ type: 'plan', action: 'install', sourceRef: { input, kind: 'repository' } })
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t('plugins')}
        description={loadedNotice === null ? t('subtitle') : `${t('subtitle')} ${loadedNotice}`}
        closeLabel={t('close')}
        className={css.shell}
        contentClassName={css.shellContent}
      >
        <div className={css.app}>
          {/* Top Minimal Toolbar */}
          <header className={css.topbar}>
            <div className={css.topbarLeft}>
              <div className={css.searchBox}>
                <Input
                  icon={<IconSearch size={14} />}
                  aria-label={t('search.label')}
                  onChange={event => { filters.setSearch(event.target.value) }}
                  placeholder={t('search.placeholder')}
                  value={filters.search}
                />
                {filters.search !== '' && (
                  <ToolbarAction
                    label={t('search.clear')}
                    icon={<IconClose size={13} />}
                    onClick={() => { filters.setSearch('') }}
                  />
                )}
              </div>
              <SortMenu value={filters.sort} t={t} onChange={filters.setSort} />
            </div>

            <div className={css.topbarRight}>
              <Button
                className={css.sourceBtn}
                icon={<IconGitBranch size={14} />}
                onClick={() => { setInstallModalOpen(true) }}
                size="sm"
                variant="ghost"
              >
                {t('install-from-repository')}
              </Button>
              <ToolbarAction
                disabled={data.busy}
                label={data.busy ? t('working') : t('refresh')}
                icon={<IconRefresh size={14} />}
                onClick={() => { void runCommand({ type: 'refresh', force: true }) }}
              />
            </div>
          </header>

          {data.snapshot?.selfUpdate?.updateAvailable === true && (
            <div className={css.banner}>
              <span>{t('self-update', { version: data.snapshot.selfUpdate.latestVersion ?? '' })}</span>
              <Button variant="outline" size="sm" onClick={() => { void runCommand({ type: 'plan', action: 'update', pluginId: 'plugin-marketplace' }) }}>
                {t('update-now')}
              </Button>
            </div>
          )}

          {data.snapshot?.preview !== null && data.snapshot?.preview !== undefined && (
            <div className={`${css.banner} ${css.bannerActive}`}>
              <strong>{t('preview.running', { plugin: data.snapshot.preview.packId ?? data.snapshot.preview.pluginId })}</strong>
              <Button variant="outline" size="sm" disabled={data.busy} onClick={() => { void runCommand({ type: 'discard' }) }}>
                {t('discard')}
              </Button>
              <Button variant="primary" size="sm" disabled={data.busy} onClick={() => { setApplyAcknowledged(false); setApplyOpen(true) }}>
                {t('apply-action', { action: t(`action.${data.snapshot.preview.action}`) })}
              </Button>
            </div>
          )}

          {error !== null && (
            <Alert variant="destructive" className={css.errorAlert}>
              <AlertDescription>{error}</AlertDescription>
              <AlertAction>
                <Button variant="outline" size="sm" disabled={data.busy} onClick={() => { filters.reset(); void runCommand({ type: 'refresh', force: true }) }}>
                  {t('reset-and-reload')}
                </Button>
              </AlertAction>
            </Alert>
          )}

          {actionNotice !== null && (
            <div className={css.banner}>
              <span>{actionNotice}</span>
              {data.snapshot?.undoAvailable === true && (
                <Button variant="outline" size="sm" disabled={data.busy} onClick={() => { void runCommand({ type: 'undo' }) }}>
                  {t('undo-last-apply')}
                </Button>
              )}
            </div>
          )}

          {/* Three Column Professional Layout */}
          <div className={css.workbench} data-mobile-view={mobileView}>
            {/* Column 1: Category & Status Sidebar Navigation */}
            <aside className={css.navCol}>
              <div className={css.navGroup}>
                <span className={css.navTitle}>{t('installation-status')}</span>
                <button
                  className={css.navItem}
                  data-active={String(filters.statusFilter === 'all' && filters.categoryFilter === 'all')}
                  onClick={() => { filters.setStatusFilter('all'); filters.setCategoryFilter('all') }}
                  type="button"
                >
                  <IconApps size={14} />
                  <span className={css.navLabel}>{t('all')}</span>
                  <span className={css.navCount}>{viewMeta.statusCounts.all}</span>
                </button>
                <button
                  className={css.navItem}
                  data-active={String(filters.statusFilter === 'installed')}
                  onClick={() => { filters.setStatusFilter('installed'); filters.setCategoryFilter('all') }}
                  type="button"
                >
                  <IconDownload size={14} />
                  <span className={css.navLabel}>{t('installed')}</span>
                  {viewMeta.statusCounts.installed > 0 && (
                    <span className={css.navCount}>{viewMeta.statusCounts.installed}</span>
                  )}
                </button>
                <button
                  className={css.navItem}
                  data-active={String(filters.statusFilter === 'updates')}
                  onClick={() => { filters.setStatusFilter('updates'); filters.setCategoryFilter('all') }}
                  type="button"
                >
                  <IconRotate size={14} />
                  <span className={css.navLabel}>{t('updates')}</span>
                  {viewMeta.statusCounts.updates > 0 && (
                    <span className={`${css.navCount} ${css.navCountWarn}`}>{viewMeta.statusCounts.updates}</span>
                  )}
                </button>
              </div>

              <div className={css.navGroup}>
                <span className={css.navTitle}>{t('plugin-category')}</span>
                {viewMeta.categories.map(cat => {
                  const active = filters.categoryFilter === cat
                  return (
                    <button
                      className={css.navItem}
                      data-active={String(active)}
                      key={cat}
                      onClick={() => {
                        filters.setCategoryFilter(active ? 'all' : cat)
                        filters.setStatusFilter('all')
                      }}
                      type="button"
                    >
                      {getCategoryIcon(cat, 14)}
                      <span className={css.navLabel}>{cat}</span>
                    </button>
                  )
                })}
              </div>
            </aside>

            {/* Column 2: 2-Column Dense Plugin Grid */}
            <main className={css.gridCol}>
              {data.snapshot === null || (data.busy && data.snapshot.catalog.length === 0) ? (
                <LoadingState className="oh-marketplace-empty" label={t('loading-catalog')} />
              ) : data.snapshot.auth.status !== 'ready' && data.snapshot.catalog.length === 0 ? (
                <EmptyState layout="centered" className="oh-marketplace-empty" title={t('github-auth-required')} description={localizedAuthDetail(data.snapshot.auth.detail, t)} />
              ) : viewMeta.plugins.length === 0 ? (
                <EmptyState layout="centered" className="oh-marketplace-empty" title={t('no-match')} />
              ) : (
                <PluginGridList
                  locale={localeTag(locale)}
                  onSelect={selectPlugin}
                  plugins={viewMeta.plugins}
                  selectedId={filters.selectedId}
                  t={t}
                />
              )}
            </main>

            {/* Column 3: Full-height Detail Panel */}
            <section className={css.detailCol}>
              {selected !== null && data.snapshot !== null ? (
                <PluginDetail
                  bridge={bridge}
                  close={clearSelection}
                  locale={locale}
                  pending={data.busy}
                  plugin={selected}
                  run={async command => { await runCommand(command) }}
                  snapshot={data.snapshot}
                  t={t}
                />
              ) : (
                <EmptyState layout="centered" className="oh-marketplace-empty" title={t('select-plugin')} description={t('select-plugin-description')} />
              )}
            </section>
          </div>

          {data.snapshot?.preview !== null && data.snapshot?.preview !== undefined && (
            <RiskConfirmation
              open={applyOpen}
              title={t('apply-action', { action: t(`action.${data.snapshot.preview.action}`) })}
              description={t('recovery-note')}
              acknowledgeLabel={t('apply-acknowledge')}
              cancelLabel={t('cancel')}
              confirmLabel={t('apply-to-desktop')}
              acknowledged={applyAcknowledged}
              disabled={data.busy}
              onAcknowledgedChange={setApplyAcknowledged}
              onCancel={() => { setApplyOpen(false) }}
              onConfirm={() => { setApplyOpen(false); void runCommand({ type: 'apply' }) }}
            />
          )}
        </div>
      </Modal>

      {/* Standalone Modal for Install from Repository */}
      <Modal
        open={installModalOpen}
        onClose={() => { setInstallModalOpen(false) }}
        title={t('install-from-repository')}
        closeLabel={t('close')}
      >
        <div className={css.installModalForm}>
          <p>{t('repository-help')}</p>
          <Input
            aria-label={t('direct-source.label')}
            onChange={event => { filters.setRepositoryInput(event.target.value) }}
            placeholder={t('direct-source.placeholder')}
            value={filters.repositoryInput}
          />
          <div className={css.installModalActions}>
            <Button onClick={() => { setInstallModalOpen(false) }} size="sm" variant="ghost">
              {t('cancel')}
            </Button>
            <Button
              disabled={data.busy || filters.repositoryInput.trim() === ''}
              onClick={planRepository}
              size="sm"
              variant="primary"
            >
              {t('direct-source.submit')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}

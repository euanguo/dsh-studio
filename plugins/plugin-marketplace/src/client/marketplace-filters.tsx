/**
 * marketplace-filters.tsx (leaf-4.2 / C34)
 * ---------------------------------------------------------------------
 * View-local filter state + the toolbar that edits it.
 *
 * C34 (reset without effect): all filter state lives in this hook, and the
 * surface remounts this subtree with a `key` tied to the modal open state
 * (see plugin.tsx). Reopening the modal therefore yields fresh defaults
 * through React's key remount — no `useEffect` watching `open` to reset the
 * five fields (search / repo / status / category / selection).
 *
 * `filters.reset()` is still available for the error-banner "reset and
 * reload" action, which must reset without a remount.
 */
import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  Input,
  Modal,
  Pill,
  RiskConfirmation,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  Alert,
  AlertAction,
  AlertDescription,
  EmptyState,
  LoadingState,
  ScrollArea,
} from '@dsh-studio/shared/ui'
import type { LocaleService, Translate } from '@dsh-studio/shared/i18n'
import { IconClose, IconSearch } from '@dsh-studio/shared/tabler-icons'
import type { DesktopBridge } from '@dsh-studio/shared/desktop-contracts'
import type {
  MarketplaceCommand,
  MarketplacePlugin,
  MarketplaceSnapshot,
} from '../protocol.ts'
import type { MarketplaceMessage } from './i18n.ts'
import { CategoryMenu, PluginCard } from './marketplace-browse.tsx'
import { PluginDetail } from './plugin-detail.tsx'
import {
  marketplaceActionNotice,
  localizedAuthDetail,
  marketplaceLoadedNotice,
} from './marketplace-notices.ts'
import type { MarketplaceDispatchOutcome } from './store.ts'

export type StatusFilter = 'all' | 'installed' | 'available' | 'updates' | 'disabled'

/** Filter + selection state owned by this surface instance (see C34). */
export interface MarketplaceFilters {
  search: string
  setSearch(value: string): void
  repositoryInput: string
  setRepositoryInput(value: string): void
  statusFilter: StatusFilter
  setStatusFilter(value: StatusFilter): void
  categoryFilter: string
  setCategoryFilter(value: string): void
  selectedId: string | null
  setSelectedId(value: string | null): void
  reset(): void
}

export function useMarketplaceFilters(): MarketplaceFilters {
  const [search, setSearch] = useState('')
  const [repositoryInput, setRepositoryInput] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const reset = useCallback((): void => {
    setSearch('')
    setRepositoryInput('')
    setStatusFilter('all')
    setCategoryFilter('all')
    setSelectedId(null)
  }, [])
  return {
    search,
    setSearch,
    repositoryInput,
    setRepositoryInput,
    statusFilter,
    setStatusFilter,
    categoryFilter,
    setCategoryFilter,
    selectedId,
    setSelectedId,
    reset,
  }
}

export interface MarketplaceCatalogView {
  categories: readonly string[]
  statusCounts: Record<StatusFilter, number>
  plugins: MarketplacePlugin[]
}

/** Derive the filtered catalog view from snapshot + filters. */
export function deriveMarketplaceCatalog(
  snapshot: MarketplaceSnapshot | null,
  filters: MarketplaceFilters,
): MarketplaceCatalogView {
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
  const { statusFilter, categoryFilter } = filters
  const plugins = catalog.filter(plugin => {
    if (statusFilter === 'installed' && !plugin.installed) return false
    if (statusFilter === 'available' && plugin.installed) return false
    if (statusFilter === 'updates' && !plugin.updateAvailable) return false
    if (statusFilter === 'disabled' && (!plugin.installed || plugin.enabled)) return false
    if (categoryFilter !== 'all' && plugin.category !== categoryFilter) return false
    return needle === '' || [plugin.title, plugin.description, plugin.category, ...plugin.tags]
      .some(value => value.toLowerCase().includes(needle))
  })
  return { categories, statusCounts, plugins }
}

const STATUS_TABS = [
  ['all', 'all'],
  ['installed', 'installed'],
  ['available', 'not-installed'],
  ['updates', 'updates'],
  ['disabled', 'disabled'],
] as const

/** The marketplace toolbar: search, direct-source, status tabs, categories. */
export function MarketplaceToolbar({
  t,
  pending,
  filters,
  categories,
  statusCounts,
  onDirectSubmit,
}: {
  t: Translate<MarketplaceMessage>
  pending: boolean
  filters: MarketplaceFilters
  categories: readonly string[]
  statusCounts: Record<StatusFilter, number>
  onDirectSubmit(): void
}): JSX.Element {
  return (
    <div className="oh-marketplace-toolbar">
      <div className="oh-marketplace-search">
        <Input
          icon={<IconSearch size={16} />}
          aria-label={t('search.label')}
          onChange={event => { filters.setSearch(event.target.value) }}
          placeholder={t('search.placeholder')}
          value={filters.search}
        />
        {filters.search !== '' && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('search.clear')}
            icon={<IconClose size={14} />}
            onClick={() => { filters.setSearch('') }}
          />
        )}
      </div>
      <div className="oh-marketplace-direct-source">
        <Input
          aria-label={t('direct-source.label')}
          onChange={event => { filters.setRepositoryInput(event.target.value) }}
          placeholder={t('direct-source.placeholder')}
          value={filters.repositoryInput}
        />
        <Button
          disabled={pending || filters.repositoryInput.trim() === ''}
          onClick={onDirectSubmit}
          size="sm"
          variant="outline"
        >
          {t('direct-source.submit')}
        </Button>
      </div>
      <div className="oh-marketplace-status-tabs" role="group" aria-label={t('installation-status')}>
        {STATUS_TABS.map(([value, labelKey]) => (
          <Pill
            active={filters.statusFilter === value}
            key={value}
            onClick={() => { filters.setStatusFilter(value) }}
          >
            {t(labelKey)}<span>{statusCounts[value]}</span>
          </Pill>
        ))}
      </div>
      <CategoryMenu
        categories={categories}
        value={filters.categoryFilter}
        t={t}
        onChange={filters.setCategoryFilter}
      />
    </div>
  )
}

function asDirectPlugin(
  snapshot: MarketplaceSnapshot | null,
): MarketplacePlugin | null {
  const candidate = snapshot?.candidate
  if (candidate === null || candidate === undefined) return null
  return {
    catalogSourceId: candidate.source.catalogSourceId,
    category: 'direct-repository',
    currentCommit: null,
    description: candidate.description,
    enabled: false,
    id: candidate.identity.pluginId,
    installed: false,
    latestCommit: candidate.source.resolvedCommit,
    mechanism: candidate.mechanism,
    protected: false,
    pushedAt: null,
    repository: candidate.identity.repository,
    runtimeRisk: candidate.mechanism === 'bundle' ? 'profile-bundle' : 'guided',
    tags: candidate.evidence.metadata?.keywords ?? [],
    title: candidate.evidence.metadata?.displayName ?? candidate.identity.packageName ?? candidate.identity.pluginId,
    trust: 'untrusted',
    updateAvailable: false,
    url: candidate.source.locator,
  }
}

/** The keyed marketplace modal body (C34: remounted on open -> fresh filters). */
export function MarketplaceModal({
  t,
  locale,
  open,
  onClose,
  bridge,
  data,
  run,
}: {
  t: Translate<MarketplaceMessage>
  locale: LocaleService
  open: boolean
  onClose(): void
  bridge: DesktopBridge
  data: { snapshot: MarketplaceSnapshot | null; busy: boolean; localError: string | null }
  run: (command: MarketplaceCommand) => Promise<MarketplaceDispatchOutcome>
}): JSX.Element {
  const filters = useMarketplaceFilters()
  const viewMeta = useMemo(
    () => deriveMarketplaceCatalog(data.snapshot, filters),
    [data.snapshot, filters],
  )
  const error = data.localError ?? data.snapshot?.error ?? null
  const loadedNotice = marketplaceLoadedNotice(data.snapshot, t)
  const actionNotice = marketplaceActionNotice(data.snapshot, error, t)
  const directPlugin = useMemo(() => asDirectPlugin(data.snapshot), [data.snapshot])
  const selected = viewMeta.plugins.find(plugin => plugin.id === filters.selectedId)
    ?? (directPlugin?.id === filters.selectedId ? directPlugin : null)

  const [applyOpen, setApplyOpen] = useState(false)
  const [applyAcknowledged, setApplyAcknowledged] = useState(false)

  const runCommand = useCallback(async (command: MarketplaceCommand): Promise<MarketplaceDispatchOutcome> => {
    const outcome = await run(command)
    if (command.type === 'prepare'
      && outcome.snapshot?.candidate !== null && outcome.snapshot?.candidate !== undefined) {
      filters.setSelectedId(outcome.snapshot.candidate.identity.pluginId)
    }
    return outcome
  }, [run, filters])

  const prepareRepository = (): void => {
    const input = filters.repositoryInput.trim()
    if (input === '') return
    void runCommand({
      action: 'install',
      sourceRef: { input, kind: 'repository' },
      type: 'prepare',
    })
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t('plugins')}
        description={loadedNotice === null ? t('subtitle') : `${t('subtitle')} ${loadedNotice}`}
        closeLabel={t('close')}
        className="oh-marketplace-shell"
        contentClassName="oh-marketplace-shell-content"
        footer={(
          <div className="oh-marketplace-shell-footer">
            <span className="oh-marketplace-count">
              {t('plugin-count', { count: viewMeta.plugins.length })}
            </span>
            {data.snapshot?.undoAvailable === true && (
              <Button variant="outline" size="sm" disabled={data.busy} onClick={() => { void runCommand({ type: 'undo' }) }}>
                {t('undo-last-apply')}
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={data.busy} onClick={() => { void runCommand({ type: 'refresh', force: true }) }}>
              {data.busy ? t('working') : t('refresh')}
            </Button>
          </div>
        )}
      >
        <div className="oh-marketplace-app">
        {data.snapshot?.preview !== null && data.snapshot?.preview !== undefined && (
          <div className="oh-marketplace-preview-banner">
            <strong>{t('preview.running', { plugin: data.snapshot.preview.pluginId })}</strong>
            <Button variant="outline" size="sm" disabled={data.busy} onClick={() => { void runCommand({ type: 'discard' }) }}>
              {t('discard')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={data.busy}
              onClick={() => {
                setApplyAcknowledged(false)
                setApplyOpen(true)
              }}
            >
              {t('apply-action', { action: t(`action.${data.snapshot.preview.action}`) })}
            </Button>
          </div>
        )}
        {error !== null && (
          <Alert variant="destructive" className="oh-marketplace-error">
            <AlertDescription>{error}</AlertDescription>
            <AlertAction>
              <Button
                variant="outline"
                size="sm"
                disabled={data.busy}
                onClick={() => { filters.reset(); void runCommand({ type: 'refresh', force: true }) }}
              >
                {t('reset-and-reload')}
              </Button>
            </AlertAction>
          </Alert>
        )}
        {actionNotice !== null && (
          <div className="oh-marketplace-notice">
            {actionNotice}
          </div>
        )}
        <MarketplaceToolbar
          t={t}
          pending={data.busy}
          filters={filters}
          categories={viewMeta.categories}
          statusCounts={viewMeta.statusCounts}
          onDirectSubmit={prepareRepository}
        />
        {data.snapshot?.candidate !== null && data.snapshot?.candidate !== undefined && (
          <div
            className="oh-marketplace-direct-candidate"
            data-execution={data.snapshot.candidate.execution}
            onClick={() => {
              if (data.snapshot?.candidate?.identity.pluginId !== undefined) {
                filters.setSelectedId(data.snapshot.candidate.identity.pluginId)
              }
            }}
            role="button"
            tabIndex={0}
          >
            <strong>{data.snapshot.candidate.evidence.metadata?.displayName ?? data.snapshot.candidate.identity.packageName}</strong>
            <span>{data.snapshot.candidate.source.installSpec}</span>
            <span>{data.snapshot.candidate.execution}</span>
          </div>
        )}
        <ScrollArea className="oh-marketplace-main" viewportClassName="dsh-studio-ui-scroll-viewport-inset">
          {data.snapshot === null || data.busy && data.snapshot.catalog.length === 0 ? (
            <LoadingState className="oh-marketplace-empty" label={t('loading-catalog')} />
          ) : data.snapshot.auth.status !== 'ready' && data.snapshot.catalog.length === 0 ? (
            <EmptyState
              layout="centered"
              className="oh-marketplace-empty"
              title={t('github-auth-required')}
              description={localizedAuthDetail(data.snapshot.auth.detail, t)}
            />
          ) : viewMeta.plugins.length === 0 ? (
            <EmptyState layout="centered" className="oh-marketplace-empty" title={t('no-match')} />
          ) : (
            <div className="oh-marketplace-grid">
              {viewMeta.plugins.map(plugin => (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  selected={filters.selectedId === plugin.id}
                  select={() => { filters.setSelectedId(plugin.id) }}
                  t={t}
                />
              ))}
            </div>
          )}
        </ScrollArea>
        </div>
      </Modal>
      {open && selected !== null && data.snapshot !== null && (
        <PluginDetail
          bridge={bridge}
          pending={data.busy}
          plugin={selected}
          snapshot={data.snapshot}
          locale={locale}
          t={t}
          close={() => { filters.setSelectedId(null) }}
          run={(command) => { void runCommand(command); return Promise.resolve() }}
        />
      )}
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
          onConfirm={() => {
            setApplyOpen(false)
            void runCommand({ type: 'apply' })
          }}
        />
      )}
    </>
  )
}
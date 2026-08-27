import { useState } from 'react'
import { Button, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import { IconChevronDown, IconChevronRight, IconFileText } from '@dsh-studio/shared/tabler-icons'
import type { MarketplacePlugin, MarketplaceSort } from '../protocol.ts'
import type { MarketplaceMessage } from './i18n.ts'
import { compatibilityLabel, compatibilityTone, formatMarketplaceCount, localizedDescription, mechanismLabel } from './marketplace-meta.ts'

export function CategoryMenu({
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
      align="start"
      portal
      dense
      onSelect={id => { setOpen(false); onChange(id) }}
      anchor={(
        <Button
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={t('plugin-category')}
          className="oh-marketplace-menu-trigger"
          onClick={() => { setOpen(current => !current) }}
          size="sm"
          variant="outline"
        >
          <span>{value === 'all' ? t('all-categories') : value}</span>
          <IconChevronDown size={14} />
        </Button>
      )}
    />
  )
}

export function SortMenu({
  value,
  t,
  onChange,
}: {
  value: MarketplaceSort
  t: Translate<MarketplaceMessage>
  onChange(value: MarketplaceSort): void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const options = [
    ['smart', 'sort.smart'],
    ['stars', 'sort.stars'],
    ['downloads', 'sort.downloads'],
    ['updated', 'sort.updated'],
    ['name', 'sort.name'],
  ] as const
  const items: MenuEntry[] = options.map(([id, label]) => ({ id, label: t(label) }))
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={items}
      selectedId={value}
      align="start"
      portal
      dense
      onSelect={id => { setOpen(false); onChange(id as MarketplaceSort) }}
      anchor={(
        <Button
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={t('sort.label')}
          className="oh-marketplace-menu-trigger"
          onClick={() => { setOpen(current => !current) }}
          size="sm"
          variant="outline"
        >
          <span>{t(options.find(([id]) => id === value)?.[1] ?? 'sort.smart')}</span>
          <IconChevronDown size={14} />
        </Button>
      )}
    />
  )
}

export function PluginCard({
  plugin,
  selected,
  select,
  move,
  tabIndex,
  t,
  locale,
}: {
  plugin: MarketplacePlugin
  selected: boolean
  select(): void
  move(direction: 'next' | 'previous' | 'first' | 'last'): void
  tabIndex: number
  t: Translate<MarketplaceMessage>
  locale: string
}): JSX.Element {
  const status = plugin.installed
    ? plugin.enabled ? t('enabled') : t('disabled')
    : t('not-installed')
  return (
    <button
      aria-label={`${plugin.title} · ${compatibilityLabel(plugin.compatibility.status, t)}`}
      aria-selected={selected}
      className="oh-marketplace-card"
      data-selected={String(selected)}
      onClick={select}
      onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); move('next') }
        if (event.key === 'ArrowUp') { event.preventDefault(); move('previous') }
        if (event.key === 'Home') { event.preventDefault(); move('first') }
        if (event.key === 'End') { event.preventDefault(); move('last') }
      }}
      role="option"
      tabIndex={tabIndex}
      type="button"
    >
      <span className="oh-marketplace-card-main">
        <span className="oh-marketplace-card-heading">
          <strong>{plugin.title}</strong>
          {plugin.screenshots.length > 0 && <IconFileText aria-label={t('screenshots')} size={14} />}
        </span>
        <span className="oh-marketplace-card-description">{localizedDescription(plugin, locale)}</span>
        <span className="oh-marketplace-card-meta">{plugin.category} · {mechanismLabel(plugin, t)}</span>
      </span>
      <span className="oh-marketplace-card-side">
        <span className="oh-marketplace-compatibility" data-tone={compatibilityTone(plugin.compatibility.status)}>
          <span aria-hidden="true" className="oh-marketplace-compatibility-dot" />
          {compatibilityLabel(plugin.compatibility.status, t)}
        </span>
        <span className="oh-marketplace-card-status" data-update={String(plugin.updateAvailable)}>{plugin.updateAvailable ? t('update-available') : status}</span>
        <span className="oh-marketplace-card-metrics">★ {formatMarketplaceCount(plugin.stars)} · ↓ {formatMarketplaceCount(plugin.downloads)}</span>
        <IconChevronRight aria-hidden="true" size={16} />
      </span>
    </button>
  )
}

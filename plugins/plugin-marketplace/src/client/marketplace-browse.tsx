import { useState } from 'react'
import { Menu, type MenuEntry, Pill } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import { IconChevronDown, IconFileText } from '@dsh-studio/shared/tabler-icons'
import type { MarketplacePlugin } from '../protocol.ts'
import type { MarketplaceMessage } from './i18n.ts'
import { compatibilityLabel, compatibilityTone, formatMarketplaceCount, localizedDescription, pluginMeta } from './marketplace-meta.ts'

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
      align="end"
      portal
      compact
      onSelect={id => { setOpen(false); onChange(id) }}
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

export function SortMenu({
  value,
  t,
  onChange,
}: {
  value: 'smart' | 'stars' | 'downloads' | 'updated' | 'name'
  t: Translate<MarketplaceMessage>
  onChange(value: 'smart' | 'stars' | 'downloads' | 'updated' | 'name'): void
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
      align="end"
      portal
      compact
      onSelect={id => { setOpen(false); onChange(id as 'smart' | 'stars' | 'downloads' | 'updated' | 'name') }}
      anchor={(
        <button
          type="button"
          className="oh-marketplace-selector"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('sort.label')}
          onClick={() => { setOpen(current => !current) }}
        >
          {t(options.find(([id]) => id === value)?.[1] ?? 'sort.smart')}
          <IconChevronDown size={14} />
        </button>
      )}
    />
  )
}

export function PluginCard({
  plugin,
  selected,
  select,
  t,
  locale,
}: {
  plugin: MarketplacePlugin
  selected: boolean
  select(): void
  t: Translate<MarketplaceMessage>
  locale: string
}): JSX.Element {
  return (
    <button
      className="oh-marketplace-card"
      data-selected={String(selected)}
      onClick={select}
      type="button"
    >
      <div className="oh-marketplace-card-heading">
        <h2>{plugin.title}</h2>
        {plugin.screenshots.length > 0 && <IconFileText aria-label={t('screenshots')} size={14} />}
      </div>
      <div className="oh-marketplace-card-meta">{pluginMeta(plugin, t)}</div>
      <div className="oh-marketplace-card-badges">
        <Pill active={compatibilityTone(plugin.compatibility.status) === 'positive'}>
          {compatibilityLabel(plugin.compatibility.status, t)}
        </Pill>
        <Pill>{t(`trust.${plugin.trust}`)}</Pill>
        <Pill>{plugin.preferredChannel ?? 'github'}</Pill>
        {plugin.updateAvailable && <Pill active>{t('update-available')}</Pill>}
      </div>
      <div className="oh-marketplace-card-metrics">
        <span>★ {formatMarketplaceCount(plugin.stars)}</span>
        <span>↓ {formatMarketplaceCount(plugin.downloads)}</span>
      </div>
      <p className="oh-marketplace-card-description">{localizedDescription(plugin, locale)}</p>
    </button>
  )
}

/** Marketplace browse surfaces: the category filter menu and the plugin
 *  card grid entry — pure presentational pieces of the marketplace view. */
import { useState } from 'react'
import {
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import { IconChevronDown } from '@dsh-studio/shared/tabler-icons'
import type { MarketplacePlugin } from '../protocol.ts'
import type { MarketplaceMessage } from './i18n.ts'
import { pluginMeta } from './marketplace-meta.ts'
import { MarketplaceCss } from './styles.js'

/** Category dropdown: filters the card grid ("all" = no filter). */
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
      onSelect={(id) => {
        setOpen(false)
        onChange(id)
      }}
      anchor={(
        <button
          type="button"
          className={MarketplaceCss["oh-marketplace-selector"]}
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

/** One plugin card in the grid; clicking selects it into the detail view. */
export function PluginCard({
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
      className={MarketplaceCss["oh-marketplace-card"]}
      data-selected={String(selected)}
      onClick={select}
      type="button"
    >
      <h2>{plugin.title}</h2>
      <div className={MarketplaceCss["oh-marketplace-card-meta"]}>{pluginMeta(plugin, t)}</div>
      <p className={MarketplaceCss["oh-marketplace-card-description"]}>{plugin.description}</p>
    </button>
  )
}
import { useRef, useState, type ReactNode } from 'react'
import { Button, Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@dsh-studio/shared/i18n'
import {
  IconApps,
  IconBox,
  IconBrowser,
  IconChevronDown,
  IconCode,
  IconCpu,
  IconDatabase,
  IconDeviceMobile,
  IconDownload,
  IconFolderCode,
  IconLanguage,
  IconPalette,
  IconPlug,
  IconRobot,
  IconShield,
  IconSparkles,
  IconStar,
  IconTerminal,
  IconTool,
  IconWorld,
} from '@dsh-studio/shared/tabler-icons'
import type { MarketplacePlugin, MarketplaceSort } from '../protocol.ts'
import type { MarketplaceMessage } from './i18n.ts'
import {
  compatibilityLabel,
  compatibilityTone,
  formatMarketplaceCount,
  localizedDescription,
} from './marketplace-meta.ts'
import { MarketplaceCss as css } from './styles.js'

export function getCategoryIcon(category: string, size = 15): ReactNode {
  const cat = category.toLowerCase().trim()
  if (cat.includes('theme') || cat.includes('skin') || cat.includes('appearance')) return <IconPalette size={size} />
  if (cat.includes('ui') || cat.includes('layout') || cat.includes('sidebar') || cat.includes('view')) return <IconBrowser size={size} />
  if (cat.includes('agent') || cat.includes('ai') || cat.includes('team') || cat.includes('llm')) return <IconRobot size={size} />
  if (cat.includes('tool') || cat.includes('util') || cat.includes('helper')) return <IconTool size={size} />
  if (cat.includes('security') || cat.includes('audit') || cat.includes('pentest') || cat.includes('auth')) return <IconShield size={size} />
  if (cat.includes('remote') || cat.includes('web') || cat.includes('net') || cat.includes('sync')) return <IconWorld size={size} />
  if (cat.includes('engine') || cat.includes('core') || cat.includes('system') || cat.includes('runtime')) return <IconCpu size={size} />
  if (cat.includes('git') || cat.includes('vcs') || cat.includes('branch') || cat.includes('diff')) return <IconFolderCode size={size} />
  if (cat.includes('code') || cat.includes('dev') || cat.includes('syntax') || cat.includes('lint')) return <IconCode size={size} />
  if (cat.includes('term') || cat.includes('shell') || cat.includes('pty') || cat.includes('cli')) return <IconTerminal size={size} />
  if (cat.includes('lang') || cat.includes('i18n') || cat.includes('translate')) return <IconLanguage size={size} />
  if (cat.includes('data') || cat.includes('store') || cat.includes('db') || cat.includes('sqlite')) return <IconDatabase size={size} />
  if (cat.includes('mobile') || cat.includes('pocket') || cat.includes('phone') || cat.includes('device')) return <IconDeviceMobile size={size} />
  if (cat.includes('pack') || cat.includes('bundle')) return <IconBox size={size} />
  if (cat.includes('plugin') || cat.includes('extension')) return <IconPlug size={size} />
  return <IconSparkles size={size} />
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
  const anchorRef = useRef<HTMLSpanElement | null>(null)
  const options = [
    ['smart', 'sort.smart'],
    ['stars', 'sort.stars'],
    ['downloads', 'sort.downloads'],
    ['updated', 'sort.updated'],
    ['name', 'sort.name'],
  ] as const
  const currentLabel = t(options.find(([id]) => id === value)?.[1] ?? 'sort.smart')
  const items: MenuEntry[] = options.map(([id, label]) => ({ id, label: t(label) }))

  return (
    <span ref={anchorRef} className={css.menuAnchor}>
      <Button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('sort.label')}
        className={css.menuTrigger}
        onClick={() => { setOpen(current => !current) }}
        size="sm"
        variant="outline"
      >
        <span>{currentLabel}</span>
        <IconChevronDown size={14} />
      </Button>
      <Menu
        open={open}
        anchor={null}
        portal
        getAnchorRect={() => anchorRef.current?.getBoundingClientRect() ?? null}
        items={items}
        selectedId={value}
        onSelect={id => {
          setOpen(false)
          onChange(id as MarketplaceSort)
        }}
        onClose={() => { setOpen(false) }}
      />
    </span>
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
  const isInstalled = plugin.installed
  const isEnabled = plugin.installed && plugin.enabled
  const isUpdate = plugin.updateAvailable

  return (
    <div
      aria-label={`${plugin.title} · ${compatibilityLabel(plugin.compatibility.status, t)}`}
      aria-selected={selected}
      className={css.card}
      data-selected={String(selected)}
      onClick={select}
      onKeyDown={event => {
        if (event.key === 'ArrowDown') { event.preventDefault(); move('next') }
        if (event.key === 'ArrowUp') { event.preventDefault(); move('previous') }
        if (event.key === 'Home') { event.preventDefault(); move('first') }
        if (event.key === 'End') { event.preventDefault(); move('last') }
      }}
      role="gridcell"
      tabIndex={tabIndex}
    >
      <div className={css.cardHeader}>
        <div className={css.cardTitleGroup}>
          <span className={css.cardIcon}>{getCategoryIcon(plugin.category, 14)}</span>
          <strong className={css.cardTitle}>{plugin.title}</strong>
        </div>
        {isUpdate ? (
          <span className={`${css.cardBadge} ${css.cardBadgeUpdate}`}>{t('update-available')}</span>
        ) : isInstalled ? (
          <span className={`${css.cardBadge} ${isEnabled ? css.cardBadgeInstalled : css.cardBadgeDisabled}`}>
            {isEnabled ? t('installed') : t('disabled')}
          </span>
        ) : null}
      </div>

      <p className={css.cardDesc}>
        {localizedDescription(plugin, locale) || t('select-plugin-description')}
      </p>

      <div className={css.cardFooter}>
        <span className={css.cardMeta}>{plugin.category}</span>
        <div className={css.cardMetrics}>
          <span className={css.cardMetric}>
            <IconStar size={12} /> {formatMarketplaceCount(plugin.stars)}
          </span>
          <span className={css.cardMetric}>
            <IconDownload size={12} /> {formatMarketplaceCount(plugin.downloads)}
          </span>
        </div>
      </div>
    </div>
  )
}

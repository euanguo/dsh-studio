import type { DesktopSkinsMessage } from './i18n.ts'
import type { DesktopSkinId } from '../preferences.ts'

export type SkinColorScheme = 'light' | 'dark'

export interface DesktopSkin {
  id: DesktopSkinId
  colorScheme: SkinColorScheme
  tokens: Readonly<Record<string, string>>
  preview: string
  accent: string
  label: DesktopSkinsMessage
  css?: string
}

const DEEP_CURRENT_TOKENS = {
  '--dsw-alias-bg-base': '#071923',
  '--dsw-alias-bg-layer-1': '#0b2230',
  '--dsw-alias-bg-layer-2': '#0f2a39',
  '--dsw-alias-bg-layer-3': '#143445',
  '--dsw-alias-bg-overlay': '#193e50',
  '--dsw-alias-bg-module-platform': '#0f2a39',
  '--dsw-alias-border-l1': 'rgba(143, 214, 235, 0.08)',
  '--dsw-alias-border-l2': 'rgba(143, 214, 235, 0.14)',
  '--dsw-alias-border-l3': 'rgba(143, 214, 235, 0.22)',
  '--dsw-alias-brand-primary': '#49c8eb',
  '--dsw-alias-brand-primary-invert': '#06151d',
  '--dsw-alias-brand-text': '#bcecf8',
  '--dsw-alias-button-primary-fill': '#49c8eb',
  '--dsw-alias-button-primary-hover': '#6dd7f2',
  '--dsw-alias-interactive-bg-active': 'rgba(109, 215, 242, 0.16)',
  '--dsw-alias-interactive-bg-hover': 'rgba(109, 215, 242, 0.09)',
  '--dsw-alias-label-primary': '#e9f8fb',
  '--dsw-alias-label-secondary': '#b9dbe4',
  '--dsw-alias-label-tertiary': '#78a8b5',
  '--dsw-alias-markdown-code-block': '#06151e',
  '--dsw-alias-markdown-inline-code': '#123143',
  '--dsw-alias-scrollbar-bg-l1': '#214b5c',
  '--dsw-alias-scrollbar-hover-l1': '#49c8eb',
  '--dsw-alias-state-error-primary': '#ff7185',
  '--dsw-alias-state-success-primary': '#63d5ad',
  '--dsw-alias-state-warn-primary': '#f4c56a',
  '--dsw-specific-bubble': '#123143',
  '--dsw-specific-input-major': '#0a202c',
  '--dsw-specific-menu': '#103041',
  '--dsw-specific-sidebar-fill': '#071923',
  '--dsw-specific-sidebar-nav-item-active': '#123143',
  '--dsw-specific-sidebar-nav-item-hover': '#0d2938',
} as const

const JADE_CIRCUIT_TOKENS = {
  '--dsw-alias-bg-base': '#071a16',
  '--dsw-alias-bg-layer-1': '#0b241e',
  '--dsw-alias-bg-layer-2': '#102e26',
  '--dsw-alias-bg-layer-3': '#15392f',
  '--dsw-alias-bg-overlay': '#1b493b',
  '--dsw-alias-bg-module-platform': '#102e26',
  '--dsw-alias-border-l1': 'rgba(124, 236, 187, 0.08)',
  '--dsw-alias-border-l2': 'rgba(124, 236, 187, 0.14)',
  '--dsw-alias-border-l3': 'rgba(124, 236, 187, 0.22)',
  '--dsw-alias-brand-primary': '#52d6a0',
  '--dsw-alias-brand-primary-invert': '#071a16',
  '--dsw-alias-brand-text': '#bbf3d8',
  '--dsw-alias-button-primary-fill': '#52d6a0',
  '--dsw-alias-button-primary-hover': '#72e5b4',
  '--dsw-alias-interactive-bg-active': 'rgba(114, 229, 180, 0.16)',
  '--dsw-alias-interactive-bg-hover': 'rgba(114, 229, 180, 0.08)',
  '--dsw-alias-label-primary': '#e9fbf3',
  '--dsw-alias-label-secondary': '#b9ddce',
  '--dsw-alias-label-tertiary': '#78a795',
  '--dsw-alias-markdown-code-block': '#061510',
  '--dsw-alias-markdown-inline-code': '#14372d',
  '--dsw-alias-scrollbar-bg-l1': '#205240',
  '--dsw-alias-scrollbar-hover-l1': '#52d6a0',
  '--dsw-alias-state-error-primary': '#ff7185',
  '--dsw-alias-state-success-primary': '#52d6a0',
  '--dsw-alias-state-warn-primary': '#f3c966',
  '--dsw-specific-bubble': '#14372d',
  '--dsw-specific-input-major': '#0a211b',
  '--dsw-specific-menu': '#123329',
  '--dsw-specific-sidebar-fill': '#071a16',
  '--dsw-specific-sidebar-nav-item-active': '#14372d',
  '--dsw-specific-sidebar-nav-item-hover': '#0e2b23',
} as const

const PORCELAIN_TOKENS = {
  '--dsw-alias-bg-base': '#f3f7f6',
  '--dsw-alias-bg-layer-1': '#f8fbfa',
  '--dsw-alias-bg-layer-2': '#edf4f2',
  '--dsw-alias-bg-layer-3': '#e5efec',
  '--dsw-alias-bg-overlay': '#dce9e6',
  '--dsw-alias-bg-module-platform': '#edf4f2',
  '--dsw-alias-border-l1': 'rgba(24, 70, 67, 0.07)',
  '--dsw-alias-border-l2': 'rgba(24, 70, 67, 0.12)',
  '--dsw-alias-border-l3': 'rgba(24, 70, 67, 0.18)',
  '--dsw-alias-brand-primary': '#2d7773',
  '--dsw-alias-brand-primary-invert': '#f7fbfa',
  '--dsw-alias-brand-text': '#245f5c',
  '--dsw-alias-button-primary-fill': '#2d7773',
  '--dsw-alias-button-primary-hover': '#378b86',
  '--dsw-alias-interactive-bg-active': 'rgba(45, 119, 115, 0.14)',
  '--dsw-alias-interactive-bg-hover': 'rgba(45, 119, 115, 0.07)',
  '--dsw-alias-label-primary': '#18312f',
  '--dsw-alias-label-secondary': '#405d59',
  '--dsw-alias-label-tertiary': '#718b87',
  '--dsw-alias-markdown-code-block': '#e8f0ee',
  '--dsw-alias-markdown-inline-code': '#dfebe8',
  '--dsw-alias-scrollbar-bg-l1': '#cddeda',
  '--dsw-alias-scrollbar-hover-l1': '#8aaca6',
  '--dsw-alias-state-error-primary': '#c65358',
  '--dsw-alias-state-success-primary': '#418b68',
  '--dsw-alias-state-warn-primary': '#b77b25',
  '--dsw-specific-bubble': '#e8f0ee',
  '--dsw-specific-input-major': '#fbfdfc',
  '--dsw-specific-menu': '#edf4f2',
  '--dsw-specific-sidebar-fill': '#f3f7f6',
  '--dsw-specific-sidebar-nav-item-active': '#dfeae8',
  '--dsw-specific-sidebar-nav-item-hover': '#e8f0ee',
} as const

const EMBER_DUSK_TOKENS = {
  '--dsw-alias-bg-base': '#21161f',
  '--dsw-alias-bg-layer-1': '#2a1b27',
  '--dsw-alias-bg-layer-2': '#342130',
  '--dsw-alias-bg-layer-3': '#40283a',
  '--dsw-alias-bg-overlay': '#4b3042',
  '--dsw-alias-bg-module-platform': '#342130',
  '--dsw-alias-border-l1': 'rgba(255, 183, 159, 0.08)',
  '--dsw-alias-border-l2': 'rgba(255, 183, 159, 0.14)',
  '--dsw-alias-border-l3': 'rgba(255, 183, 159, 0.22)',
  '--dsw-alias-brand-primary': '#ff9275',
  '--dsw-alias-brand-primary-invert': '#23151d',
  '--dsw-alias-brand-text': '#ffd4c7',
  '--dsw-alias-button-primary-fill': '#ff9275',
  '--dsw-alias-button-primary-hover': '#ffad96',
  '--dsw-alias-interactive-bg-active': 'rgba(255, 173, 150, 0.16)',
  '--dsw-alias-interactive-bg-hover': 'rgba(255, 173, 150, 0.08)',
  '--dsw-alias-label-primary': '#fff0ea',
  '--dsw-alias-label-secondary': '#dfc1cb',
  '--dsw-alias-label-tertiary': '#a98391',
  '--dsw-alias-markdown-code-block': '#1b121a',
  '--dsw-alias-markdown-inline-code': '#3b2636',
  '--dsw-alias-scrollbar-bg-l1': '#563649',
  '--dsw-alias-scrollbar-hover-l1': '#ff9275',
  '--dsw-alias-state-error-primary': '#ff6f82',
  '--dsw-alias-state-success-primary': '#7bd3a6',
  '--dsw-alias-state-warn-primary': '#efbe69',
  '--dsw-specific-bubble': '#3b2636',
  '--dsw-specific-input-major': '#281923',
  '--dsw-specific-menu': '#382331',
  '--dsw-specific-sidebar-fill': '#21161f',
  '--dsw-specific-sidebar-nav-item-active': '#3b2636',
  '--dsw-specific-sidebar-nav-item-hover': '#301e2b',
} as const

/*
 * Synara Night — faithful mapping of the Synara web-next design system (dark).
 *
 * Seed contract (theme-tokens.css): only --theme-surface / --theme-surface-under /
 * --theme-ink / --theme-accent are swapped per theme; every semantic token derives
 * from those four. Live dark seeds: surface #181818, surface-under #141414,
 * ink #ffffff, accent #339cff.
 *
 * Key measured nodes:
 *   surface #181818 · surface-under #141414 · popover rgb(45,45,45) ·
 *   menu glass rgba(54,54,54,0.96) · border ladder 4.2% / 8.4% / 15.6% white ·
 *   surface-hover 7.8% · surface-selected 5.2% · surface-active 15% · fog 2.5%
 *   focus rgba(131,195,255,0.76) · input-fill rgba(45,45,45,0.96) ·
 *   scrollbar thumb rgba(255,255,255,0.07) / hover 0.14 ·
 *   primary CTA = ink reverse (white fill, ink text — not accent blue) ·
 *   status: destructive #ff6764 · success #40c977 · warning #ff8549
 */
const SYNARA_NIGHT_TOKENS = {
  '--dsw-alias-bg-base': '#141414',
  '--dsw-alias-bg-layer-1': '#181818',
  '--dsw-alias-bg-layer-2': '#1f1f1f',
  '--dsw-alias-bg-layer-3': '#262626',
  '--dsw-alias-bg-overlay': '#2d2d2d',
  '--dsw-alias-bg-module-platform': '#181818',
  '--dsw-alias-border-l1': 'rgba(255, 255, 255, 0.042)',
  '--dsw-alias-border-l2': 'rgba(255, 255, 255, 0.084)',
  '--dsw-alias-border-l3': 'rgba(255, 255, 255, 0.156)',
  '--dsw-alias-brand-primary': '#339cff',
  '--dsw-alias-brand-primary-invert': '#141414',
  '--dsw-alias-brand-text': '#83c3ff',
  '--dsw-alias-button-primary-fill': '#ffffff',
  '--dsw-alias-button-primary-hover': '#e8e8e8',
  '--dsw-alias-interactive-bg-active': 'rgba(255, 255, 255, 0.15)',
  '--dsw-alias-interactive-bg-hover': 'rgba(255, 255, 255, 0.078)',
  '--dsw-alias-label-primary': '#ffffff',
  '--dsw-alias-label-secondary': 'rgba(255, 255, 255, 0.65)',
  '--dsw-alias-label-tertiary': 'rgba(255, 255, 255, 0.5)',
  '--dsw-alias-markdown-code-block': 'rgba(255, 255, 255, 0.025)',
  '--dsw-alias-markdown-inline-code': '#1e1e1e',
  '--dsw-alias-scrollbar-bg-l1': 'rgba(255, 255, 255, 0.07)',
  '--dsw-alias-scrollbar-hover-l1': 'rgba(255, 255, 255, 0.14)',
  '--dsw-alias-state-error-primary': '#ff6764',
  '--dsw-alias-state-success-primary': '#40c977',
  '--dsw-alias-state-warn-primary': '#ff8549',
  '--dsw-specific-bubble': '#1f1f1f',
  '--dsw-specific-input-major': 'rgba(45, 45, 45, 0.96)',
  '--dsw-specific-menu': 'rgba(54, 54, 54, 0.96)',
  '--dsw-specific-sidebar-fill': '#141414',
  '--dsw-specific-sidebar-nav-item-active': '#202020',
  '--dsw-specific-sidebar-nav-item-hover': '#262626',
} as const

/*
 * Synara Day — faithful mapping of the Synara web-next design system (light).
 *
 * Light seeds: surface #ffffff, surface-under #f4f4f4, ink #141414,
 * accent #0d6efd (light accent is deliberately deeper than dark's #339cff
 * to keep contrast on white).
 *
 * Key measured nodes:
 *   popover = surface 96% + ink ≈ #f6f6f6 · menu glass = popover 96% ·
 *   border ladder 4.2% / 8.4% / 15.6% ink · hover 7.8% · selected 5.2% ·
 *   active 15% · fog 2.5% · focus rgba(13,110,253,0.76) ·
 *   input-fill ink 3.5% · primary CTA = ink (dark fill, white text) ·
 *   scrollbar thumb rgba(0,0,0,0.1) / hover 0.18 ·
 *   status: destructive #ba2623 · success #008635 · warning #d97706
 */
const SYNARA_DAY_TOKENS = {
  '--dsw-alias-bg-base': '#f4f4f4',
  '--dsw-alias-bg-layer-1': '#ffffff',
  '--dsw-alias-bg-layer-2': '#fbfbfb',
  '--dsw-alias-bg-layer-3': '#f8f8f8',
  '--dsw-alias-bg-overlay': '#f4f4f4',
  '--dsw-alias-bg-module-platform': '#ffffff',
  '--dsw-alias-border-l1': 'rgba(20, 20, 20, 0.042)',
  '--dsw-alias-border-l2': 'rgba(20, 20, 20, 0.084)',
  '--dsw-alias-border-l3': 'rgba(20, 20, 20, 0.156)',
  '--dsw-alias-brand-primary': '#0d6efd',
  '--dsw-alias-brand-primary-invert': '#ffffff',
  '--dsw-alias-brand-text': '#0d6efd',
  '--dsw-alias-button-primary-fill': '#141414',
  '--dsw-alias-button-primary-hover': '#2f2f2f',
  '--dsw-alias-interactive-bg-active': 'rgba(20, 20, 20, 0.15)',
  '--dsw-alias-interactive-bg-hover': 'rgba(20, 20, 20, 0.078)',
  '--dsw-alias-label-primary': '#141414',
  '--dsw-alias-label-secondary': 'rgba(20, 20, 20, 0.65)',
  '--dsw-alias-label-tertiary': 'rgba(20, 20, 20, 0.5)',
  '--dsw-alias-markdown-code-block': 'rgba(20, 20, 20, 0.025)',
  '--dsw-alias-markdown-inline-code': '#f9f9f9',
  '--dsw-alias-scrollbar-bg-l1': 'rgba(0, 0, 0, 0.1)',
  '--dsw-alias-scrollbar-hover-l1': 'rgba(0, 0, 0, 0.18)',
  '--dsw-alias-state-error-primary': '#ba2623',
  '--dsw-alias-state-success-primary': '#008635',
  '--dsw-alias-state-warn-primary': '#d97706',
  '--dsw-specific-bubble': '#fbfbfb',
  '--dsw-specific-input-major': 'rgba(20, 20, 20, 0.035)',
  '--dsw-specific-menu': 'rgba(244, 244, 244, 0.96)',
  '--dsw-specific-sidebar-fill': '#f4f4f4',
  '--dsw-specific-sidebar-nav-item-active': '#e8e8e8',
  '--dsw-specific-sidebar-nav-item-hover': '#e3e3e3',
} as const

export const DESKTOP_SKINS: readonly DesktopSkin[] = Object.freeze([
  Object.freeze({
    id: 'oh-dsh-skin-deep-current',
    colorScheme: 'dark',
    tokens: DEEP_CURRENT_TOKENS,
    preview: 'linear-gradient(135deg, #071923 0%, #143445 64%, #49c8eb 145%)',
    accent: '#49c8eb',
    label: 'skins.name.deep-current',
  }),
  Object.freeze({
    id: 'oh-dsh-skin-jade-circuit',
    colorScheme: 'dark',
    tokens: JADE_CIRCUIT_TOKENS,
    preview: 'linear-gradient(145deg, #071a16 0 42%, #154435 43% 62%, #52d6a0 150%)',
    accent: '#52d6a0',
    label: 'skins.name.jade-circuit',
  }),
  Object.freeze({
    id: 'oh-dsh-skin-porcelain',
    colorScheme: 'light',
    tokens: PORCELAIN_TOKENS,
    preview: 'radial-gradient(circle at 78% 22%, #b9dcd7 0%, transparent 38%), linear-gradient(145deg, #f8fbfa 0%, #e5efec 100%)',
    accent: '#2d7773',
    label: 'skins.name.porcelain',
  }),
  Object.freeze({
    id: 'oh-dsh-skin-ember-dusk',
    colorScheme: 'dark',
    tokens: EMBER_DUSK_TOKENS,
    preview: 'radial-gradient(circle at 78% 24%, #ff9275 0%, transparent 38%), linear-gradient(145deg, #21161f 0%, #4b3042 100%)',
    accent: '#ff9275',
    label: 'skins.name.ember-dusk',
  }),
  Object.freeze({
    id: 'oh-dsh-skin-synara-night',
    colorScheme: 'dark',
    tokens: SYNARA_NIGHT_TOKENS,
    preview: 'linear-gradient(145deg, #141414 0 38%, #2d2d2d 40% 62%, #339cff 150%)',
    accent: '#339cff',
    label: 'skins.name.synara-night',
  }),
  Object.freeze({
    id: 'oh-dsh-skin-synara-day',
    colorScheme: 'light',
    tokens: SYNARA_DAY_TOKENS,
    preview: 'linear-gradient(145deg, #f4f4f4 0 38%, #ffffff 40% 62%, #0d6efd 150%)',
    accent: '#0d6efd',
    label: 'skins.name.synara-day',
  }),
])

export function desktopSkin(id: string): DesktopSkin | undefined {
  return DESKTOP_SKINS.find(skin => skin.id === id)
}

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

const CHATGPT_NIGHT_TOKENS = {
  '--dsw-alias-bg-base': '#181818',
  '--dsw-alias-bg-layer-1': '#212121',
  '--dsw-alias-bg-layer-2': '#232323',
  '--dsw-alias-bg-layer-3': '#282828',
  '--dsw-alias-bg-overlay': '#2d2d2d',
  '--dsw-alias-bg-module-platform': '#1f1f1f',
  '--dsw-alias-border-l1': 'rgba(255, 255, 255, 0.042)',
  '--dsw-alias-border-l2': 'rgba(255, 255, 255, 0.084)',
  '--dsw-alias-border-l3': 'rgba(255, 255, 255, 0.156)',
  '--dsw-alias-brand-primary': '#ffffff',
  '--dsw-alias-brand-primary-invert': '#0d0d0d',
  '--dsw-alias-brand-text': '#ffffff',
  '--dsw-alias-button-primary-fill': '#ffffff',
  '--dsw-alias-button-primary-hover': '#ececec',
  '--dsw-alias-interactive-bg-active': 'rgba(255, 255, 255, 0.1)',
  '--dsw-alias-interactive-bg-hover': 'rgba(255, 255, 255, 0.08)',
  '--dsw-alias-label-primary': '#ffffff',
  '--dsw-alias-label-secondary': '#b3b3b3',
  '--dsw-alias-label-tertiary': '#808080',
  '--dsw-alias-markdown-code-block': '#1f1f1f',
  '--dsw-alias-markdown-inline-code': 'rgba(255, 255, 255, 0.08)',
  '--dsw-alias-scrollbar-bg-l1': '#3d3d3d',
  '--dsw-alias-scrollbar-hover-l1': 'rgba(255, 255, 255, 0.3)',
  '--dsw-alias-state-error-primary': '#ff6764',
  '--dsw-alias-state-success-primary': '#40c977',
  '--dsw-alias-state-warn-primary': '#ffd240',
  '--dsw-specific-bubble': '#2f2f2f',
  '--dsw-specific-input-major': '#2d2d2d',
  '--dsw-specific-menu': '#2d2d2d',
  '--dsw-specific-sidebar-fill': '#141414',
  '--dsw-specific-sidebar-nav-item-active': 'rgba(255, 255, 255, 0.08)',
  '--dsw-specific-sidebar-nav-item-hover': 'rgba(255, 255, 255, 0.08)',
} as const

const CHATGPT_DAY_TOKENS = {
  '--dsw-alias-bg-base': '#ffffff',
  '--dsw-alias-bg-layer-1': '#ffffff',
  '--dsw-alias-bg-layer-2': '#fafafa',
  '--dsw-alias-bg-layer-3': '#f4f4f4',
  '--dsw-alias-bg-overlay': '#ffffff',
  '--dsw-alias-bg-module-platform': '#f9f9f9',
  '--dsw-alias-border-l1': 'rgba(26, 28, 31, 0.049)',
  '--dsw-alias-border-l2': 'rgba(26, 28, 31, 0.078)',
  '--dsw-alias-border-l3': 'rgba(26, 28, 31, 0.117)',
  '--dsw-alias-brand-primary': '#1a1c1f',
  '--dsw-alias-brand-primary-invert': '#ffffff',
  '--dsw-alias-brand-text': '#1a1c1f',
  '--dsw-alias-button-primary-fill': '#1a1c1f',
  '--dsw-alias-button-primary-hover': '#2e3136',
  '--dsw-alias-interactive-bg-active': 'rgba(26, 28, 31, 0.1)',
  '--dsw-alias-interactive-bg-hover': 'rgba(26, 28, 31, 0.08)',
  '--dsw-alias-label-primary': '#1a1c1f',
  '--dsw-alias-label-secondary': '#5e6164',
  '--dsw-alias-label-tertiary': '#8a8d91',
  '--dsw-alias-markdown-code-block': '#f4f4f4',
  '--dsw-alias-markdown-inline-code': 'rgba(26, 28, 31, 0.08)',
  '--dsw-alias-scrollbar-bg-l1': '#e3e4e5',
  '--dsw-alias-scrollbar-hover-l1': 'rgba(26, 28, 31, 0.2)',
  '--dsw-alias-state-error-primary': '#ba2623',
  '--dsw-alias-state-success-primary': '#00a240',
  '--dsw-alias-state-warn-primary': '#e0ac00',
  '--dsw-specific-bubble': '#f4f4f4',
  '--dsw-specific-input-major': '#ffffff',
  '--dsw-specific-menu': '#ffffff',
  '--dsw-specific-sidebar-fill': '#f6f6f6',
  '--dsw-specific-sidebar-nav-item-active': 'rgba(26, 28, 31, 0.08)',
  '--dsw-specific-sidebar-nav-item-hover': 'rgba(26, 28, 31, 0.08)',
} as const


const CHATGPT_GEOMETRY_CSS = `
/* ================================================================
   ChatGPT 皮肤 · 尺寸/材质规范（CSS token 体系，实测对照）
   原则：所有尺寸来自 token；行高 = 字号 × 1.43 + padding 垂直 × 2，
   由间距体系自然形成，不写死高度。
   ================================================================ */
body[data-oh-dsh-skin*="chatgpt"] {
  --gw-skin-row-fs: 13px;
  --gw-skin-row-lh: calc(var(--gw-skin-row-fs) * 1.43);
  --gw-skin-row-py: 5px;
  --gw-skin-row-px: 8px;
  --gw-skin-row-pad: var(--gw-skin-row-py) var(--gw-skin-row-px);
  --gw-skin-row-h: calc(var(--gw-skin-row-lh) + var(--gw-skin-row-py) * 2);
  --gw-skin-radius-row: 12.5px;
  --gw-skin-radius-menu: 12.5px;
  --gw-skin-radius-card: 25px;
  --gw-skin-radius-pill: 999px;
  --gw-skin-gap-item: 4px;
  --gw-skin-menu-pad: 4px;
  --gw-skin-blur: 8px;
  --gw-skin-menu-bg: rgba(45, 45, 45, .9);
  --gw-skin-hairline: rgba(255, 255, 255, .156);
  --gw-skin-elevation: 0 3px 7.5px rgba(0, 0, 0, .04), 0 0 20px rgba(0, 0, 0, .04);
  --gw-skin-hover-transition: background-color .15s cubic-bezier(.4, 0, .2, 1), color .15s cubic-bezier(.4, 0, .2, 1);
  --gw-skin-disabled-opacity: .4;
}
body[data-oh-dsh-skin="oh-dsh-skin-chatgpt-day"] {
  --gw-skin-menu-bg: rgba(255, 255, 255, .96);
  --gw-skin-hairline: rgba(26, 28, 31, .117);
}

body[data-oh-dsh-skin] button,
body[data-oh-dsh-skin] [role="button"],
body[data-oh-dsh-skin] [role="menuitem"],
body[data-oh-dsh-skin] [role="menuitemradio"],
body[data-oh-dsh-skin] [role="menuitemcheckbox"],
body[data-oh-dsh-skin] [role="option"],
body[data-oh-dsh-skin] [role="tab"] {
  corner-shape: superellipse(1.5);
}

body[data-oh-dsh-skin] [class*="_list_"],
body[data-oh-dsh-skin] [class*="_submenu_"],
body[data-oh-dsh-skin] [class*="_menu"]:not([class*="menuOpen"]):not([class*="menuStatus"]),
body[data-oh-dsh-skin] [role="listbox"],
body[data-oh-dsh-skin] [role="menu"] {
  background: var(--gw-skin-menu-bg) !important;
  backdrop-filter: blur(var(--gw-skin-blur)) !important;
  -webkit-backdrop-filter: blur(var(--gw-skin-blur)) !important;
  border: 0 !important;
  border-radius: var(--gw-skin-radius-menu) !important;
  padding: var(--gw-skin-menu-pad) !important;
  box-shadow: 0 0 0 .5px var(--gw-skin-hairline), var(--gw-skin-elevation) !important;
}

body[data-oh-dsh-skin] [class*="_item_"]:not([class*="_itemWrap"]):not([class*="_itemLabel"]):not([class*="_itemAction"]),
body[data-oh-dsh-skin] [role="menuitem"],
body[data-oh-dsh-skin] [role="menuitemradio"],
body[data-oh-dsh-skin] [role="menuitemcheckbox"],
body[data-oh-dsh-skin] [role="option"] {
  min-height: var(--gw-skin-row-h) !important;
  padding: var(--gw-skin-row-pad) !important;
  font-size: var(--gw-skin-row-fs) !important;
  line-height: var(--gw-skin-row-lh) !important;
  border-radius: var(--gw-skin-radius-row) !important;
}
body[data-oh-dsh-skin] [class*="_itemWrap"],
body[data-oh-dsh-skin] [class*="_itemLabel"] {
  padding: 0 !important;
  line-height: inherit !important;
}

body[data-oh-dsh-skin] [role="listbox"] [role="option"] + [role="option"],
body[data-oh-dsh-skin] [role="menu"] [role="menuitem"] + [role="menuitem"] {
  margin-top: var(--gw-skin-gap-item);
}

body[data-oh-dsh-skin] [class*="_navCell"] {
  height: auto !important;
  min-height: var(--gw-skin-row-h) !important;
  padding: var(--gw-skin-row-pad) !important;
  font-size: var(--gw-skin-row-fs) !important;
  line-height: var(--gw-skin-row-lh) !important;
  border-radius: var(--gw-skin-radius-row) !important;
}

/* 通用按钮主配方（ruleset 2.1 主配方）：所有 button 默认行按钮
   12.5px superellipse，无需逐个组件特判。 */
body[data-oh-dsh-skin] button {
  border-radius: var(--gw-skin-radius-row) !important;
  corner-shape: superellipse(1.5);
}

/* 弹出触发/选择器按钮（aria-haspopup、trigger/seat/workspace 类）：
   ChatGPT 选择器形态 —— pill 胶囊 + 行高。
   排除菜单项（带 submenu 的 menuitem 也挂 aria-haspopup，但保持行按钮形态）；
   排除 workspaceLabel 等内部文本容器（避免行高强加导致文本顶对齐）。 */
body[data-oh-dsh-skin] button[aria-haspopup]:not([role="menuitem"]),
body[data-oh-dsh-skin] [class*="_trigger"]:not([class*="_triggerLabel"]),
body[data-oh-dsh-skin] [class*="_seat"],
body[data-oh-dsh-skin] [class*="_workspace"]:not([class*="_workspaceLabel"]) {
  height: var(--gw-skin-row-h) !important;
  border-radius: var(--gw-skin-radius-pill) !important;
  corner-shape: round;
}
/* 触发器内部图标容器：强制居中（DSH triggerIcon 无 align-items，高度变化后 svg 贴顶） */
body[data-oh-dsh-skin] [class*="_triggerIcon"],
body[data-oh-dsh-skin] [class*="_icon"] {
  align-items: center !important;
  justify-content: center !important;
}
/* 触发器/选择器文本 label：block 内文本贴顶 → flex 垂直居中
   （修复文字偏上 4-5px；workspaceLabel 同款问题一并覆盖）。 */
body[data-oh-dsh-skin] [class*="_triggerLabel"],
body[data-oh-dsh-skin] [class*="_workspaceLabel"] {
  display: flex !important;
  align-items: center !important;
  line-height: var(--gw-skin-row-lh) !important;
}
/* 菜单分组标签（Group by/Order by）：统一 ChatGPT 规范 13px tertiary + 4px 8px */
body[data-oh-dsh-skin] [class*="_label_"] {
  padding: 4px 8px !important;
  font-size: 13px !important;
  line-height: 18.57px !important;
  color: var(--dsw-alias-label-tertiary) !important;
}

body[data-oh-dsh-skin] [class*="_selector"] {
  height: 28px !important;
  min-height: 28px;
  padding: 0 12px !important;
  font-size: 14px !important;
  border-radius: var(--gw-skin-radius-row) !important;
}

body[data-oh-dsh-skin] [class*="_newSession"]:not([class*="_newSessionLabel"]) {
  min-height: var(--gw-skin-row-h);
  padding: var(--gw-skin-row-pad) !important;
  font-size: var(--gw-skin-row-fs) !important;
  border-radius: var(--gw-skin-radius-row) !important;
}

/* 会话/项目行：尺寸交给 DSH 自身行高（32/34px，content-box 下勿加 padding），仅统一圆角 */
body[data-oh-dsh-skin] [class*="_sessionRow"],
body[data-oh-dsh-skin] [class*="_projectRow"],
body[data-oh-dsh-skin] [class*="_workspaceRow"],
body[data-oh-dsh-skin] [class*="_treeRow"] {
  border-radius: var(--gw-skin-radius-row) !important;
}

body[data-oh-dsh-skin] [class*="_card"],
body[data-oh-dsh-skin] [class*="_dialog"] {
  border-radius: var(--gw-skin-radius-card) !important;
}
body[data-oh-dsh-skin] [class*="_dialog"] {
  border: 0 !important;
  box-shadow: 0 0 0 .5px var(--gw-skin-hairline), 0 3px 7.5px rgba(0, 0, 0, .06), 0 0 20px rgba(0, 0, 0, .06) !important;
}

body[data-oh-dsh-skin] [class*="_renameInput"] {
  font-size: var(--gw-skin-row-fs) !important;
  line-height: var(--gw-skin-row-lh) !important;
  padding: var(--gw-skin-row-pad) !important;
  border-radius: var(--gw-skin-radius-row) !important;
  border: 1px solid var(--dsw-alias-border-l2) !important;
  background: var(--dsw-specific-input-major) !important;
}
body[data-oh-dsh-skin] [class*="_renameInput"]:focus {
  border-color: var(--dsw-alias-state-business-primary) !important;
  box-shadow: none !important;
}

body[data-oh-dsh-skin] [class*="_themeCube"],
body[data-oh-dsh-skin] [class*="skins-tile"] {
  border-radius: var(--gw-skin-radius-menu) !important;
}

/* Button 组件 md 规格（ruleset 2.2 对话框按钮）：32px 高 + 6×16 padding。 */
body[data-oh-dsh-skin] [class*="_button_"][class*="_md"] {
  height: 32px !important;
  padding: 6px 16px !important;
}

/* 实心主操作键（发送键等非 Button 组件体系）：全圆 pill。 */
body[data-oh-dsh-skin] [class*="_primary"]:not([class*="_button_"]) {
  border-radius: var(--gw-skin-radius-pill) !important;
  corner-shape: round;
}

body[data-oh-dsh-skin] button,
body[data-oh-dsh-skin] [role="button"],
body[data-oh-dsh-skin] [role="menuitem"],
body[data-oh-dsh-skin] [role="option"] {
  transition: var(--gw-skin-hover-transition);
}

body[data-oh-dsh-skin] [class*="_wrap"]:focus-within,
body[data-oh-dsh-skin] [class*="_card"]:focus-within {
  box-shadow: none !important;
  border-color: var(--dsw-alias-state-business-primary, #339cff) !important;
}

body[data-oh-dsh-skin] button[disabled] {
  opacity: var(--gw-skin-disabled-opacity);
  cursor: not-allowed;
}

`
const CHATGPT_NIGHT_COLOR_CSS = `
body[data-oh-dsh-skin="oh-dsh-skin-chatgpt-night"] {
  --dsw-alias-label-primary-foreground: #0d0d0d;
  --dsw-alias-button-primary-dimmed: rgba(255, 255, 255, .45);
  --dsw-alias-state-business-primary: #339cff;
  --dsw-alias-button-info-fill: #0d0d0d;
  --dsw-alias-button-info-hover: rgba(255, 255, 255, .12);
  --dsw-alias-brand-primary-new-colorprimary-new-color: #339cff;
  --dsw-specific-selector: rgba(255, 255, 255, .078);
  --dsw-alias-tooltip-bg: #212121;
  --dsw-alias-toast-bg: #212121;
  --dsw-alias-button-contrast-fill: #e3e3e3;
  --dsw-alias-scrollbar-bg-l2: rgba(255, 255, 255, .156);
  --dsw-alias-scrollbar-hover-l2: rgba(255, 255, 255, .3);
  --dsw-alias-bg-mask-1: rgba(0, 0, 0, .133);
  --dsw-alias-bg-mask-2: rgba(0, 0, 0, .08);
  --dsw-shadow-lv1: 0 1px 2px -1px rgba(0, 0, 0, .08);
  --dsw-shadow-lv2: 0 2px 4px -1px rgba(0, 0, 0, .08), 0 0 0 .5px rgba(255, 255, 255, .08);
  --dsw-shadow-lv3: 0 8px 16px -4px rgba(0, 0, 0, .12), 0 0 0 .5px rgba(255, 255, 255, .1);
  --dsw-mask-blur: blur(6px);
  --shiki-foreground: #e6e6e6;
  --shiki-background: #181818;
  --shiki-token-keyword: #ff8583;
  --shiki-token-function: #99ceff;
  --shiki-token-string: #66d492;
  --shiki-token-comment: rgba(255, 255, 255, .498);
  --shiki-token-constant: #ffd240;
  --shiki-token-parameter: #e6e6e6;
  --shiki-token-punctuation: rgba(255, 255, 255, .71);
}
`

const CHATGPT_DAY_COLOR_CSS = `
body[data-oh-dsh-skin="oh-dsh-skin-chatgpt-day"] {
  --dsw-alias-label-primary-foreground: #ffffff;
  --dsw-alias-button-primary-dimmed: rgba(26, 28, 31, .45);
  --dsw-alias-state-business-primary: #339cff;
  --dsw-alias-button-info-fill: #1a1c1f;
  --dsw-alias-button-info-hover: rgba(26, 28, 31, .8);
  --dsw-alias-brand-primary-new-colorprimary-new-color: #339cff;
  --dsw-specific-selector: rgba(26, 28, 31, .06);
  --dsw-alias-tooltip-bg: #212121;
  --dsw-alias-toast-bg: #212121;
  --dsw-alias-button-contrast-fill: #141414;
  --dsw-alias-scrollbar-bg-l2: rgba(26, 28, 31, .117);
  --dsw-alias-scrollbar-hover-l2: rgba(26, 28, 31, .2);
  --dsw-alias-bg-mask-1: rgba(0, 0, 0, .133);
  --dsw-alias-bg-mask-2: rgba(0, 0, 0, .08);
  --dsw-shadow-lv1: 0 1px 2px -1px rgba(0, 0, 0, .08);
  --dsw-shadow-lv2: 0 2px 4px -1px rgba(0, 0, 0, .08), 0 0 0 .5px rgba(255, 255, 255, .5);
  --dsw-shadow-lv3: 0 8px 16px -4px rgba(0, 0, 0, .12), 0 0 0 .5px rgba(255, 255, 255, .6);
  --dsw-mask-blur: blur(6px);
  --shiki-foreground: #1a1c1f;
  --shiki-background: #ffffff;
  --shiki-token-keyword: #ba2623;
  --shiki-token-function: #0169cc;
  --shiki-token-string: #008635;
  --shiki-token-comment: rgba(26, 28, 31, .498);
  --shiki-token-constant: #b9480d;
  --shiki-token-parameter: #1a1c1f;
  --shiki-token-punctuation: rgba(26, 28, 31, .71);
}
`

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
  Object.freeze({
    id: 'oh-dsh-skin-chatgpt-night',
    colorScheme: 'dark',
    tokens: CHATGPT_NIGHT_TOKENS,
    preview: 'linear-gradient(135deg, #181818 0 49%, #141414 50% 100%)',
    accent: '#339cff',
    label: 'skins.name.chatgpt-night',
    css: CHATGPT_GEOMETRY_CSS + CHATGPT_NIGHT_COLOR_CSS,
  }),
  Object.freeze({
    id: 'oh-dsh-skin-chatgpt-day',
    colorScheme: 'light',
    tokens: CHATGPT_DAY_TOKENS,
    preview: 'linear-gradient(135deg, #ffffff 0 49%, #f6f6f6 50% 100%)',
    accent: '#339cff',
    label: 'skins.name.chatgpt-day',
    css: CHATGPT_GEOMETRY_CSS + CHATGPT_DAY_COLOR_CSS,
  }),])

export function desktopSkin(id: string): DesktopSkin | undefined {
  return DESKTOP_SKINS.find(skin => skin.id === id)
}

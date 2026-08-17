import type { DesktopSkinsMessage } from './i18n.ts'
import type { DesktopSkinId } from '../preferences.ts'
import {
  CHATGPT_DAY_COLOR_TOKENS,
  CHATGPT_DAY_TOKENS,
  CHATGPT_NIGHT_COLOR_TOKENS,
  CHATGPT_NIGHT_TOKENS,
} from '../shared-tokens.ts'
import {
  BUTTON_MD,
  CARD,
  DIALOG,
  GROUP_LABEL,
  ICON,
  ITEM_LABEL,
  ITEM_WRAP,
  MENU_ITEM,
  MENU_LIST,
  MENU_SURFACE,
  NAV_CELL,
  NEW_SESSION,
  PRIMARY_PILL,
  PROJECT_ROW,
  RENAME_INPUT,
  SEAT,
  SELECTOR,
  SESSION_ROW,
  THEME_CUBE,
  TRIGGER_EFFORT,
  TRIGGER_ICON,
  TRIGGER_LABEL,
  TRIGGER_PILL,
  WORKSPACE_LABEL,
  WORKSPACE_PILL,
  WORKSPACE_ROW,
  WRAP,
} from './generated-selectors.ts'

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

/*
 * ChatGPT 皮肤 token 表：单一事实源在 ../shared-tokens.ts（构建期烘焙与
 * token 校验共用同一份定义，防止值漂移）。
 */

function renderColorCss(selector: string, tokens: Readonly<Record<string, string>>): string {
  const declarations = Object.entries(tokens)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n')
  return `${selector} {\n${declarations}\n}\n`
}

/** 给每个精确类名单独挂皮肤门控：body[data-oh-dsh-skin] .X, body[data-oh-dsh-skin] .Y
 *  —— 每个选择器都必须自带门控，否则特异性退化为 (0,1,0)，会输给通用按钮/
 *  menuitem 等门控规则（实测 .uNlE1G_trigger 圆角被 button 规则盖掉）。 */
const gate = (classes: readonly string[]): string =>
  classes.map(selector => `body[data-oh-dsh-skin] ${selector}`).join(',')

const CHATGPT_GEOMETRY_CSS = `
/* ================================================================
   ChatGPT 皮肤 · 尺寸/材质规范（CSS token 体系，实测对照）
   原则：所有尺寸来自 token；行高 = 字号 × 1.43 + padding 垂直 × 2，
   由间距体系自然形成，不写死高度。

   选择器来源：全部是构建期生成的精确哈希类名（generated-selectors.ts，
   见 docs/SKINS-BUILD-TIME-ARCHITECTURE.md §5），类名子串匹配已全部退役
   （_triggerEffort 这类误命中不会再复发）。
   ================================================================ */
body[data-oh-dsh-skin] {
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
body[data-oh-dsh-skin]:not([data-ds-dark-theme]) {
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

${gate(MENU_LIST)},
${gate(MENU_SURFACE)},
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

${gate(MENU_ITEM)},
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
/* 菜单行角色（menuitem/option 等）：组件显式 height（实测模型选择弹出层
   40px）会盖过 min-height，用 height: auto 覆盖组件钉死值——行高由
   padding + line-height 自然形成（18.59 + 5×2 = 28.59），多行内容
   （标题+描述的模式选项）自然撑开，不再需要任何多行特判。 */
body[data-oh-dsh-skin] [role="menuitem"],
body[data-oh-dsh-skin] [role="menuitemradio"],
body[data-oh-dsh-skin] [role="menuitemcheckbox"],
body[data-oh-dsh-skin] [role="option"] {
  /* content-box would add the 5px×2 padding on top of min-height and render
     a 38.59px row instead of the designed 28.59px (measured in Chromium);
     border-box makes min-height the total row height. */
  box-sizing: border-box !important;
  height: auto !important;
  min-height: var(--gw-skin-row-h) !important;
}
${gate([...ITEM_WRAP, ...ITEM_LABEL])} {
  padding: 0 !important;
  line-height: inherit !important;
}

body[data-oh-dsh-skin] [role="listbox"] [role="option"] + [role="option"],
body[data-oh-dsh-skin] [role="menu"] [role="menuitem"] + [role="menuitem"] {
  margin-top: var(--gw-skin-gap-item);
}

${gate(NAV_CELL)} {
  box-sizing: border-box !important;
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
   workspaceLabel/triggerLabel/triggerEffort 等内部文本容器不在
   TRIGGER_PILL/WORKSPACE_PILL 精确清单里（生成器已按排除规则剔除）。 */
body[data-oh-dsh-skin] button[aria-haspopup]:not([role="menuitem"]),
${gate([...TRIGGER_PILL, ...SEAT, ...WORKSPACE_PILL])} {
  height: auto !important;
  min-height: var(--gw-skin-row-h) !important;
  /* 组件自带显式 height（28–34px）与自带纵向 padding，统一用 token
     纵向 padding 替换——行高由 padding + 行高自然形成（18.59 + 5×2 =
     28.59），横向 padding 保留组件值。行高 token 统一裸文本节点
     （seat 的"标准模式"直接文本，无 label 类）。 */
  padding-top: var(--gw-skin-row-py) !important;
  padding-bottom: var(--gw-skin-row-py) !important;
  line-height: var(--gw-skin-row-lh) !important;
  border-radius: var(--gw-skin-radius-pill) !important;
  corner-shape: round;
}
/* ui-settings-general 的设置触发（xuwxfG_trigger，full-width row seat）
   同时命中上方的 button[aria-haspopup] 胶囊门控与 TRIGGER_PILL
   （0,3,1 特异性）：:has 把特异性提到 0,3,2，拉回行规范（12.5px
   superellipse，与列表/市场一致）。类名随 DSH 上游哈希变更——rc.7
   由原来的 -wizCq_trigger 重哈希为 xuwxfG_trigger（见 generated-selectors
   TRIGGER_PILL）。 */
body[data-oh-dsh-skin] button.xuwxfG_trigger:has([data-slot='settings.trigger']) {
  border-radius: var(--gw-skin-radius-row) !important;
  corner-shape: superellipse(1.5) !important;
}

/* 触发器内部图标容器：强制居中（DSH triggerIcon 无 align-items，高度变化后 svg 贴顶） */
${gate([...TRIGGER_ICON, ...ICON])} {
  align-items: center !important;
  justify-content: center !important;
}
/* 触发器/选择器文本 label：block 内文本贴顶 → flex 垂直居中
   （修复文字偏上 4-5px；workspaceLabel 同款问题一并覆盖；
     triggerEffort 是思考强度字样，同标号对待，避免整行拔高）。 */
${gate([...TRIGGER_LABEL, ...TRIGGER_EFFORT, ...WORKSPACE_LABEL])} {
  display: flex !important;
  align-items: center !important;
  line-height: var(--gw-skin-row-lh) !important;
}
/* ui-settings-general 设置触发（xuwxfG_trigger 展开行 / xuwxfG_rail 折叠座）：
   官方折叠态把图标放大到 18px，与全应用 16px 图标不一致——钉回 16px。 */
body[data-oh-dsh-skin] .xuwxfG_trigger svg,
body[data-oh-dsh-skin] .xuwxfG_rail svg {
  width: 16px !important;
  height: 16px !important;
}

/* 菜单分组标签（Group by/Order by）：统一 ChatGPT 规范 13px tertiary + 4px 8px */
${gate(GROUP_LABEL)} {
  padding: 4px 8px !important;
  font-size: 13px !important;
  line-height: 18.57px !important;
  color: var(--dsw-alias-label-tertiary) !important;
}

${gate(SELECTOR)} {
  height: auto !important;
  min-height: 28px;
  /* 组件自带 height 36px + lh 22px，覆盖后由 padding + line-height
     自然形成 28px（20 + 4×2）。 */
  padding: 4px 12px !important;
  font-size: 14px !important;
  line-height: 20px !important;
  border-radius: var(--gw-skin-radius-row) !important;
}

${gate(NEW_SESSION)} {
  min-height: var(--gw-skin-row-h);
  padding: var(--gw-skin-row-pad) !important;
  font-size: var(--gw-skin-row-fs) !important;
  border-radius: var(--gw-skin-radius-row) !important;
}

/* 会话/项目行：尺寸交给 DSH 自身行高（32/34px，content-box 下勿加 padding），仅统一圆角 */
${gate([...SESSION_ROW, ...PROJECT_ROW, ...WORKSPACE_ROW])} {
  border-radius: var(--gw-skin-radius-row) !important;
}

${gate([...CARD, ...DIALOG])} {
  border-radius: var(--gw-skin-radius-card) !important;
}
${gate(DIALOG)} {
  border: 0 !important;
  box-shadow: 0 0 0 .5px var(--gw-skin-hairline), 0 3px 7.5px rgba(0, 0, 0, .06), 0 0 20px rgba(0, 0, 0, .06) !important;
}

${gate(RENAME_INPUT)} {
  font-size: var(--gw-skin-row-fs) !important;
  line-height: var(--gw-skin-row-lh) !important;
  padding: var(--gw-skin-row-pad) !important;
  border-radius: var(--gw-skin-radius-row) !important;
  border: 1px solid var(--dsw-alias-border-l2) !important;
  background: var(--dsw-specific-input-major) !important;
}
${gate(RENAME_INPUT)}:focus {
  border-color: var(--dsw-alias-state-business-primary) !important;
  box-shadow: none !important;
}

/* themeCube 是上游 Appearance 的圆角色块；.oh-dsh-skins-tile 是本插件
   皮肤画廊自己的字面类名（非 CSS Modules，无需生成）。 */
${gate([...THEME_CUBE, '.oh-dsh-skins-tile'])} {
  border-radius: var(--gw-skin-radius-menu) !important;
}

/* Button 组件 md 规格（ruleset 2.2 对话框按钮）：32px 高 + 6×16 padding。
   注意：这是 ChatGPT 实测的盒子规格（验收项 3），6px padding + 22px
   行高的自然高度是 34px，与规格差 2px——规格优先，保留钉死并注明。 */
${gate(BUTTON_MD)} {
  height: 32px !important;
  padding: 6px 16px !important;
}

/* 实心主操作键（发送键等非 Button 组件体系）：全圆 pill。 */
${gate(PRIMARY_PILL)} {
  border-radius: var(--gw-skin-radius-pill) !important;
  corner-shape: round;
}

body[data-oh-dsh-skin] button,
body[data-oh-dsh-skin] [role="button"],
body[data-oh-dsh-skin] [role="menuitem"],
body[data-oh-dsh-skin] [role="option"] {
  transition: var(--gw-skin-hover-transition);
}

${gate(WRAP)}:focus-within,
${gate(CARD)}:focus-within {
  box-shadow: none !important;
  border-color: var(--dsw-alias-state-business-primary, #339cff) !important;
}

body[data-oh-dsh-skin] button[disabled] {
  opacity: var(--gw-skin-disabled-opacity);
  cursor: not-allowed;
}

/* ================================================================
   2026-08 全量组件审计补充（scripts/audit-skin-styles.mjs + 四组人工
   过审，报告 docs/SKINS-COMPONENT-AUDIT.md）。全部为上游精确类名。

   DSH rc.7 升级说明：审计期的 webpack 风格哈希类名（SIlZCq_close、
   Sqg4Fa_action、wI0qGa_row、lbz_ZG_chip 等）在 rc.5 时已被上游重哈希
   而整体失效（此前 pin 下即为死选择器），本轮随 rc.7 一并移除；设计
   意图保留在该审计文档。仍存活于 rc.7 的 Vite 风格类（模块源码未变）
   保留如下。
   ================================================================ */

/* 组件自带的圆形按钮：通用 button 12.5px 规则会把它们压成方角
   （实测 28×28 关闭钮被压），恢复 pill。 */
body[data-oh-dsh-skin] ._close_18d3q_30,
body[data-oh-dsh-skin] ._remove_1hk8w_53,
body[data-oh-dsh-skin] ._arrow_1hk8w_90 {
  border-radius: var(--gw-skin-radius-pill) !important;
}

/* 过滤 pill（Pill 组件 e3ygd）：pill + 行规格（官方 24px/12px 方角）。
   padding/字号/行高全在配方里，高度自然形成（18.59 + 5×2 = 28.59）。 */
body[data-oh-dsh-skin] ._pill_e3ygd_1 {
  height: auto !important;
  min-height: var(--gw-skin-row-h) !important;
  padding: var(--gw-skin-row-pad) !important;
  font-size: var(--gw-skin-row-fs) !important;
  line-height: var(--gw-skin-row-lh) !important;
  border-radius: var(--gw-skin-radius-pill) !important;
}

/* toast：官方用 button-contrast-fill（night 浅底）与语义错配；改用
   toast-bg（两套深 #212121）。day 的 label-primary-inverted 已是白字；
   night 的 inverted 是主按钮深字，需显式改白。 */
body[data-oh-dsh-skin] ._toast_fvpz7_7 {
  background: var(--dsw-alias-toast-bg) !important;
}
body[data-oh-dsh-skin="oh-dsh-skin-chatgpt-night"] ._toast_fvpz7_7 {
  color: var(--dsw-alias-label-primary) !important;
}

/* onboarding 遮罩：硬编码 #0000003d + blur 2px → mask token + 皮肤 blur */
body[data-oh-dsh-skin] ._onboardingMask_1cfrq_10 {
  background: var(--dsw-alias-bg-mask-1) !important;
  backdrop-filter: var(--dsw-mask-blur) !important;
  -webkit-backdrop-filter: var(--dsw-mask-blur) !important;
}

`
const CHATGPT_NIGHT_COLOR_CSS = renderColorCss(
  'body[data-oh-dsh-skin="oh-dsh-skin-chatgpt-night"]',
  CHATGPT_NIGHT_COLOR_TOKENS,
)

const CHATGPT_DAY_COLOR_CSS = renderColorCss(
  'body[data-oh-dsh-skin="oh-dsh-skin-chatgpt-day"]',
  CHATGPT_DAY_COLOR_TOKENS,
)

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

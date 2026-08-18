/*
 * ChatGPT 皮肤 token 单一事实源（single source of truth）。
 *
 * 同一份定义同时喂给：
 *   1. 插件注册（skins.ts 的 chatgpt-night / chatgpt-day 皮肤对象）；
 *   2. 构建期配色烘焙（scripts/bake-skin-palette.mjs，默认主题原生即 ChatGPT）；
 *   3. token 校验（scripts/verify-skin-tokens.mjs，官方 89 键零缺失对拍）。
 *
 * 数值来源：ChatGPT 桌面端（Codex v151）实测 + 派生复算（chatgpt-skin-research
 * 报告），与参考实现 ohdsh-v015 的 skins.ts 逐键一致。第二梯队（43 键）按
 * night=rgba(255,255,255,α) 白系推导、day=rgba(26,28,31,α) 黑系推导。
 *
 * 注意：tokens 里 tui 适配器需要的键必须是 hex（缺失会抛错），不要引入
 * rgba() 到那些键上。
 */

export const CHATGPT_NIGHT_TOKENS = {
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
  /* ---- 官方 token 全量补齐（第二梯队：43 个未覆盖键全部接入同套体系） ---- */
  /* 遮罩 / 骨架 / 多选 */
  '--dsw-alias-bg-mask-3': 'rgba(0, 0, 0, 0.3)',
  '--dsw-alias-bg-mask-drop': 'rgba(0, 0, 0, 0.7)',
  '--dsw-alias-bg-mask-photo': 'rgba(0, 0, 0, 0.88)',
  '--dsw-alias-bg-multi-select': 'rgba(255, 255, 255, 0.1)',
  '--dsw-alias-bg-skeleton': 'rgba(255, 255, 255, 0.06)',
  /* 边框反色 / 细分 */
  '--dsw-alias-border-inverted': 'rgba(255, 255, 255, 0.06)',
  '--dsw-alias-border-inverted2': 'rgba(255, 255, 255, 0.08)',
  '--dsw-alias-border-l2-darkmode-thin': 'rgba(255, 255, 255, 0.06)',
  '--dsw-alias-border-l4': 'rgba(255, 255, 255, 0.2)',
  /* 按钮变体（elevated / floating / ghost-active / tool-bar） */
  '--dsw-alias-button-elevated-fill': 'rgba(54, 54, 54, 0.96)',
  '--dsw-alias-button-floating-fill': 'rgba(54, 54, 54, 0.96)',
  '--dsw-alias-button-floating-hover': 'rgba(54, 54, 54, 0.9)',
  '--dsw-alias-button-ghost-active-border': 'rgba(255, 255, 255, 0.3)',
  '--dsw-alias-button-ghost-active-fill': 'rgba(255, 255, 255, 0.1)',
  '--dsw-alias-button-ghost-active-hover': 'rgba(255, 255, 255, 0.14)',
  '--dsw-alias-button-tool-bar-fill': 'rgba(255, 255, 255, 0.1)',
  '--dsw-alias-button-tool-bar-fill-invisible': 'rgba(255, 255, 255, 0.04)',
  '--dsw-alias-button-tool-bar-hover': 'rgba(255, 255, 255, 0.14)',
  /* 交互 hover 变体 */
  '--dsw-alias-interactive-bg-hover-accent': 'rgba(51, 156, 255, 0.18)',
  '--dsw-alias-interactive-bg-hover-danger': 'rgba(250, 66, 62, 0.15)',
  '--dsw-alias-interactive-bg-hover-solid': 'rgba(255, 255, 255, 0.12)',
  /* 文字层级补充 */
  '--dsw-alias-label-caption': 'rgba(255, 255, 255, 0.498)',
  '--dsw-alias-label-dimmed': 'rgba(255, 255, 255, 0.38)',
  '--dsw-alias-label-primary-bluish': 'rgba(255, 255, 255, 0.92)',
  '--dsw-alias-label-primary-dimmed': 'rgba(255, 255, 255, 0.71)',
  '--dsw-alias-label-primary-inverted': '#0d0d0d',
  /* markdown 细分 */
  '--dsw-alias-markdown-citation': 'rgba(255, 255, 255, 0.06)',
  '--dsw-alias-markdown-code-block-banner': '#212121',
  '--dsw-alias-markdown-code-segment-selected': 'rgba(255, 255, 255, 0.12)',
  '--dsw-alias-markdown-code-segment-unselected': 'rgba(255, 255, 255, 0.06)',
  '--dsw-alias-markdown-placeholder': 'rgba(255, 255, 255, 0.06)',
  '--dsw-alias-markdown-tag': 'rgba(255, 255, 255, 0.12)',
  /* 状态次级 / 三级 */
  '--dsw-alias-state-business-tertiary': '#0d273f',
  '--dsw-alias-state-error-secondary': '#ff8583',
  '--dsw-alias-state-success-secondary': '#66d492',
  '--dsw-alias-state-success-tertiary': 'rgba(64, 201, 119, 0.15)',
  '--dsw-alias-state-warn-label': '#ffd240',
  '--dsw-alias-state-warn-secondary': '#ffd866',
  '--dsw-alias-state-warn-tertiary': 'rgba(255, 210, 64, 0.15)',
  /* specific 补充 */
  '--dsw-specific-bubble-highlight': 'rgba(255, 255, 255, 0.12)',
  '--dsw-specific-login-input': '#1f1f1f',
  '--dsw-specific-sidebar-nav-item-active-accent': 'rgba(51, 156, 255, 0.2)',
  '--dsw-specific-tip': 'rgba(255, 255, 255, 0.08)',
} as const

export const CHATGPT_DAY_TOKENS = {
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
  /* ---- 官方 token 全量补齐（第二梯队：43 个未覆盖键全部接入同套体系） ---- */
  /* 遮罩 / 骨架 / 多选 */
  '--dsw-alias-bg-mask-3': 'rgba(26, 28, 31, 0.15)',
  '--dsw-alias-bg-mask-drop': 'rgba(0, 0, 0, 0.7)',
  '--dsw-alias-bg-mask-photo': 'rgba(0, 0, 0, 0.88)',
  '--dsw-alias-bg-multi-select': 'rgba(26, 28, 31, 0.1)',
  '--dsw-alias-bg-skeleton': 'rgba(26, 28, 31, 0.05)',
  /* 边框反色 / 细分 */
  '--dsw-alias-border-inverted': 'rgba(26, 28, 31, 0.06)',
  '--dsw-alias-border-inverted2': 'rgba(26, 28, 31, 0.08)',
  '--dsw-alias-border-l2-darkmode-thin': 'rgba(26, 28, 31, 0.06)',
  '--dsw-alias-border-l4': 'rgba(26, 28, 31, 0.2)',
  /* 按钮变体（elevated / floating / ghost-active / tool-bar） */
  '--dsw-alias-button-elevated-fill': '#ffffff',
  '--dsw-alias-button-floating-fill': '#ffffff',
  '--dsw-alias-button-floating-hover': 'rgba(26, 28, 31, 0.06)',
  '--dsw-alias-button-ghost-active-border': 'rgba(26, 28, 31, 0.3)',
  '--dsw-alias-button-ghost-active-fill': 'rgba(26, 28, 31, 0.1)',
  '--dsw-alias-button-ghost-active-hover': 'rgba(26, 28, 31, 0.14)',
  '--dsw-alias-button-tool-bar-fill': 'rgba(26, 28, 31, 0.08)',
  '--dsw-alias-button-tool-bar-fill-invisible': 'rgba(26, 28, 31, 0.03)',
  '--dsw-alias-button-tool-bar-hover': 'rgba(26, 28, 31, 0.12)',
  /* 交互 hover 变体 */
  '--dsw-alias-interactive-bg-hover-accent': 'rgba(51, 156, 255, 0.12)',
  '--dsw-alias-interactive-bg-hover-danger': 'rgba(224, 46, 42, 0.08)',
  '--dsw-alias-interactive-bg-hover-solid': 'rgba(26, 28, 31, 0.12)',
  /* 文字层级补充 */
  '--dsw-alias-label-caption': '#5d5d5d',
  '--dsw-alias-label-dimmed': 'rgba(26, 28, 31, 0.38)',
  '--dsw-alias-label-primary-bluish': 'rgba(26, 28, 31, 0.92)',
  '--dsw-alias-label-primary-dimmed': 'rgba(26, 28, 31, 0.71)',
  '--dsw-alias-label-primary-inverted': '#ffffff',
  /* markdown 细分 */
  '--dsw-alias-markdown-citation': 'rgba(26, 28, 31, 0.06)',
  '--dsw-alias-markdown-code-block-banner': '#fafafa',
  '--dsw-alias-markdown-code-segment-selected': 'rgba(26, 28, 31, 0.12)',
  '--dsw-alias-markdown-code-segment-unselected': 'rgba(26, 28, 31, 0.06)',
  '--dsw-alias-markdown-placeholder': 'rgba(26, 28, 31, 0.06)',
  '--dsw-alias-markdown-tag': 'rgba(26, 28, 31, 0.12)',
  /* 状态次级 / 三级 */
  '--dsw-alias-state-business-tertiary': '#e5f3ff',
  '--dsw-alias-state-error-secondary': '#e5484d',
  '--dsw-alias-state-success-secondary': '#4ed17e',
  '--dsw-alias-state-success-tertiary': 'rgba(0, 162, 64, 0.12)',
  '--dsw-alias-state-warn-label': '#e25507',
  '--dsw-alias-state-warn-secondary': '#f7ad31',
  '--dsw-alias-state-warn-tertiary': 'rgba(226, 85, 7, 0.12)',
  /* specific 补充 */
  '--dsw-specific-bubble-highlight': 'rgba(51, 156, 255, 0.1)',
  '--dsw-specific-login-input': '#f9f9f9',
  '--dsw-specific-sidebar-nav-item-active-accent': 'rgba(51, 156, 255, 0.15)',
  '--dsw-specific-tip': 'rgba(26, 28, 31, 0.06)',
} as const

/*
 * 颜色修正层（第二份单一事实源）：官方 design-platform.css 之外、但 ChatGPT
 * 皮肤需要的补充键（tooltip/toast、状态 business、shiki 高亮、阴影、遮罩等）。
 * 插件把它渲染成 body[data-oh-dsh-skin=…] 覆盖块；构建期烘焙把它们与上面的
 * token 表一起写进 dist 的 index-*.css（默认主题原生即 ChatGPT）。
 */
export const CHATGPT_NIGHT_COLOR_TOKENS = {
  '--dsw-alias-label-primary-foreground': '#0d0d0d',
  '--dsw-alias-button-primary-dimmed': 'rgba(255, 255, 255, .45)',
  '--dsw-alias-state-business-primary': '#339cff',
  '--dsw-alias-button-info-fill': '#0d0d0d',
  '--dsw-alias-button-info-hover': 'rgba(255, 255, 255, .12)',
  '--dsw-alias-brand-primary-new-colorprimary-new-color': '#339cff',
  '--dsw-specific-selector': 'rgba(255, 255, 255, .078)',
  '--dsw-alias-tooltip-bg': '#212121',
  '--dsw-alias-toast-bg': '#212121',
  '--dsw-alias-button-contrast-fill': '#e3e3e3',
  '--dsw-alias-scrollbar-bg-l2': 'rgba(255, 255, 255, .156)',
  '--dsw-alias-scrollbar-hover-l2': 'rgba(255, 255, 255, .3)',
  '--dsw-alias-bg-mask-1': 'rgba(0, 0, 0, .133)',
  '--dsw-alias-bg-mask-2': 'rgba(0, 0, 0, .08)',
  '--dsw-shadow-lv1': '0 1px 2px -1px rgba(0, 0, 0, .08)',
  '--dsw-shadow-lv2': '0 2px 4px -1px rgba(0, 0, 0, .08), 0 0 0 .5px rgba(255, 255, 255, .08)',
  '--dsw-shadow-lv3': '0 8px 16px -4px rgba(0, 0, 0, .12), 0 0 0 .5px rgba(255, 255, 255, .1)',
  '--dsw-mask-blur': 'blur(6px)',
  '--shiki-foreground': '#e6e6e6',
  '--shiki-background': '#181818',
  '--shiki-token-keyword': '#ff8583',
  '--shiki-token-function': '#99ceff',
  '--shiki-token-string': '#66d492',
  '--shiki-token-comment': 'rgba(255, 255, 255, .498)',
  '--shiki-token-constant': '#ffd240',
  '--shiki-token-parameter': '#e6e6e6',
  '--shiki-token-punctuation': 'rgba(255, 255, 255, .71)',
  /* ---- 幽灵 alias 键补充（2026-08 全量审计）：上游组件 css 引用但官方
     design-platform.css 未定义的键。官方默认主题下这些声明无效（继承父级
     颜色），补上语义值后皮肤与官方缺省都被修正。 ---- */
  '--dsw-alias-label-error': '#ff8583',
  '--dsw-alias-label-inverse': '#0d0d0d',
  '--dsw-alias-label-quaternary': 'rgba(255, 255, 255, .38)',
  '--dsw-alias-fill-l2': 'rgba(255, 255, 255, .1)',
  '--dsw-alias-separator-primary': 'rgba(255, 255, 255, .156)',
  '--dsw-alias-line-secondary': 'rgba(255, 255, 255, .084)',
  '--dsw-alias-bg-primary': '#212121',
  '--dsw-alias-border-secondary': 'rgba(255, 255, 255, .156)',
  '--dsw-alias-interactive-bg-primary': '#ffffff',
} as const

export const CHATGPT_DAY_COLOR_TOKENS = {
  '--dsw-alias-label-primary-foreground': '#ffffff',
  '--dsw-alias-button-primary-dimmed': 'rgba(26, 28, 31, .45)',
  '--dsw-alias-state-business-primary': '#339cff',
  '--dsw-alias-button-info-fill': '#1a1c1f',
  '--dsw-alias-button-info-hover': 'rgba(26, 28, 31, .8)',
  '--dsw-alias-brand-primary-new-colorprimary-new-color': '#339cff',
  '--dsw-specific-selector': 'rgba(26, 28, 31, .06)',
  '--dsw-alias-tooltip-bg': '#212121',
  '--dsw-alias-toast-bg': '#212121',
  '--dsw-alias-button-contrast-fill': '#141414',
  '--dsw-alias-scrollbar-bg-l2': 'rgba(26, 28, 31, .117)',
  '--dsw-alias-scrollbar-hover-l2': 'rgba(26, 28, 31, .2)',
  '--dsw-alias-bg-mask-1': 'rgba(0, 0, 0, .133)',
  '--dsw-alias-bg-mask-2': 'rgba(0, 0, 0, .08)',
  '--dsw-shadow-lv1': '0 1px 2px -1px rgba(0, 0, 0, .08)',
  '--dsw-shadow-lv2': '0 2px 4px -1px rgba(0, 0, 0, .08), 0 0 0 .5px rgba(255, 255, 255, .5)',
  '--dsw-shadow-lv3': '0 8px 16px -4px rgba(0, 0, 0, .12), 0 0 0 .5px rgba(255, 255, 255, .6)',
  '--dsw-mask-blur': 'blur(6px)',
  '--shiki-foreground': '#1a1c1f',
  '--shiki-background': '#ffffff',
  '--shiki-token-keyword': '#ba2623',
  '--shiki-token-function': '#0169cc',
  '--shiki-token-string': '#008635',
  '--shiki-token-comment': 'rgba(26, 28, 31, .498)',
  '--shiki-token-constant': '#b9480d',
  '--shiki-token-parameter': '#1a1c1f',
  '--shiki-token-punctuation': 'rgba(26, 28, 31, .71)',
  /* ---- 幽灵 alias 键补充（2026-08 全量审计）：上游组件 css 引用但官方
     design-platform.css 未定义的键。官方默认主题下这些声明无效（继承父级
     颜色），补上语义值后皮肤与官方缺省都被修正。 ---- */
  '--dsw-alias-label-error': '#e5484d',
  '--dsw-alias-label-inverse': '#ffffff',
  '--dsw-alias-label-quaternary': 'rgba(26, 28, 31, .38)',
  '--dsw-alias-fill-l2': 'rgba(26, 28, 31, .08)',
  '--dsw-alias-separator-primary': 'rgba(26, 28, 31, .117)',
  '--dsw-alias-line-secondary': 'rgba(26, 28, 31, .078)',
  '--dsw-alias-bg-primary': '#ffffff',
  '--dsw-alias-border-secondary': 'rgba(26, 28, 31, .117)',
  '--dsw-alias-interactive-bg-primary': '#1a1c1f',
} as const

# Synara 皮肤设计文档（Night + Day）

> 本文档记录 `oh-dsh-skin-synara-night`（暗色）与 `oh-dsh-skin-synara-day`（亮色）
> 两套皮肤的完整设计过程：从 **Synara web-next** 前端设计体系
> （`theme-tokens.css` + `theme/surface.ts` + `styles.css` + markdown 样式）
> 逐 token 探索，再到映射为 DSH `--dsw-*` 皮肤 token 的决策依据。
>
> Synara 源码位置（设计参考）：
> `apps/web-next/src/theme/theme-tokens.css`、`apps/web-next/src/theme/surface.ts`、
> `apps/web-next/src/styles.css`、`apps/web-next/src/components/markdown/conversation-markdown.css`

---

## 1. 为什么做这个皮肤

Synara web-next 是一套「seed 驱动」的主题体系：只有 4 个 chrome seed
（`--theme-surface` / `--theme-surface-under` / `--theme-ink` / `--theme-accent`）
会随主题切换，其余全部语义 token 由 seed 派生。它的暗色主题是一套
**实测打磨过的中性石墨灰 + 蓝色细线** 体系，与本仓库原有 4 套皮肤
（深海蓝、翡翠绿、瓷白、余烬橙）的气质完全不同：

| 特征 | 原有皮肤 | Synara Night |
| --- | --- | --- |
| 背景性格 | 带明显色相（蓝/绿/紫/橙） | 中性石墨灰（近无色相） |
| 主按钮 | 品牌色填充 | **ink 反色（白底黑字）** |
| 聚焦 | 品牌色粗描边 | 蓝色 0.76 alpha 细线（hairline） |
| 状态色 | 色相内协调 | 独立语义色（error/success/warning 各自独立） |
| 代码块 | 深色块 | 极淡 fog（2.5% 白） |

所以这套皮肤不是「换主色」，而是把 Synara 的**中性灰阶设计哲学**整体
移植到 DSH 皮肤体系。

## 2. Synara 暗色主题 token 探索结果（全部实测值）

来源：`apps/web-next/src/theme/theme-tokens.css` 的 `:root.dark` 块与文件头注释。

### 2.1 四个 seed（主题切换契约）

```css
--theme-surface: #181818;        /* 主表面 */
--theme-surface-under: #141414;  /* 下层表面（侧栏） */
--theme-ink: #ffffff;            /* 墨色（文字） */
--theme-accent: #339cff;         /* 强调色（蓝） */
```

### 2.2 派生语义 token（暗色实测）

| Synara token | 值 | 用途 |
| --- | --- | --- |
| `--background` | `surface #181818` | 应用底色 |
| `--card` / `--foreground` | `#181818` / `#ffffff` | 卡片同底色 |
| `--popover` | `rgb(45,45,45)` | 浮层实色底（不透明窗口） |
| `--menu` | `rgba(54,54,54,0.96)` | 菜单玻璃底（blur 时） |
| `--border-light` | ink 4.2% | 弱边框（代码块/行内码） |
| `--border` | ink 8.4% | 标准边框（引用、分割线） |
| `--border-heavy` | ink 15.6% | 强边框（输入框、elevation stroke） |
| `--surface-fog` | ink 2.5% | 极淡雾面（代码块底、markdown） |
| `--surface-hover` | ink 7.8% | 列表/菜单 hover 洗色 |
| `--surface-selected` | ink 5.2% | 选中洗色 |
| `--surface-active` | ink 15% | 图标按下洗色 |
| `--input` / `--input-fill` | 15.6% / `rgba(45,45,45,0.96)` | 输入框边框/填充 |
| `--focus` | accent 76% → `rgba(131,195,255,0.76)` | 聚焦蓝色细线 |
| `--primary` | `ink`（白） | **主 CTA = 墨色** |
| `--primary-foreground` | `surface-under`（深） | 主 CTA 文字 |
| `--muted-foreground` | ink 65% | 次级文字 |
| `--subtle-foreground` | ink 50% | 三级/说明文字 |
| `--destructive` | `#ff6764` | 错误 |
| `--success` | `#40c977` | 成功 |
| `--warning` | `#ff8549` | 警告 |
| `--sidebar` | `surface-under #141414` | 侧栏 = 下层表面 |
| `--sidebar-accent` | ink 5.2% | 侧栏 hover |
| scrollbar thumb / hover | `rgba(255,255,255,0.07)` / `0.14` | 滚动条 |

### 2.3 几何与形状（非颜色，但定义「手感」）

```css
--radius-scale: 1.25;                  /* 圆角阶梯倍率 */
--corner-shape: superellipse(1.5);     /* 超椭圆角，同 px 更圆润 */
--radius-control: calc(0.625rem * 1.25) ≈ 12.5px;
--radius-menu: radius-xl ≈ 15px;
--control-height: 32px（DEFAULT）; --control-height-icon: 28px;
--blur-menu: 8px; --blur-dialog: 20px;
--elevation-stroke: 0 0 0 0.5px var(--border-heavy);  /* 0.5px 描边阴影 */
--elevation-popover: stroke + 0 3px 7.5px black 4% + 0 0 20px black 5%;
--font-sans: "Geist Variable", ...;
--font-size-body: 14px; --font-size-caption: 12px; --font-size-micro: 11px;
```

### 2.4 markdown / 代码块关键节点

来源：`conversation-markdown.css`

| 节点 | 值 | 说明 |
| --- | --- | --- |
| 行内代码 | `bg surface-fog` + `border-light` 1px + radius-icon | 极淡雾面 |
| 代码块 | `bg surface-fog` + `border-light` + radius-control | 同雾面，无阴影 |
| 链接 | `color theme-accent`，下划线 45% alpha | 蓝色链接 |
| 引用块 | 2px `border` 左边线 + muted-foreground | 无底色 |
| 分割线 | 1px `border` | 标准边框 |

---

## 3. 映射决策：Synara token → DSH 皮肤 token

DSH 皮肤 token 是 **32 个 `--dsw-*` 变量**（26 alias + 6 specific），
语义见 `docs/PLUGIN-DEVELOPMENT.md §3.2`。映射原则：

1. **忠实取 Synara 实测值**，不重新设计色值；
2. DSH 有而 Synara 没有的层级（如 layer-1/2/3 阶梯），用 Synara 的
   灰阶比例在 `#141414 ↔ #2d2d2d` 之间线性插值，保持中性色相；
3. DSH 测试硬约束：`--dsw-alias-bg-base === --dsw-specific-sidebar-fill`，
   且 `--dsw-alias-bg-base` 必须是 6 位 hex。

### 3.1 背景层级（6 个）

| DSH token | 值 | Synara 依据 |
| --- | --- | --- |
| `--dsw-alias-bg-base` | `#141414` | `surface-under`（最底层） |
| `--dsw-alias-bg-layer-1` | `#181818` | `surface`（主内容面） |
| `--dsw-alias-bg-layer-2` | `#1f1f1f` | surface→popover 1/3 插值 |
| `--dsw-alias-bg-layer-3` | `#262626` | surface→popover 2/3 插值 |
| `--dsw-alias-bg-overlay` | `#2d2d2d` | `popover rgb(45,45,45)` |
| `--dsw-alias-bg-module-platform` | `#181818` | `surface` |

### 3.2 边框阶梯（3 个）

| DSH token | 值 | Synara 依据 |
| --- | --- | --- |
| `--dsw-alias-border-l1` | `rgba(255,255,255,0.042)` | `border-light` 4.2% |
| `--dsw-alias-border-l2` | `rgba(255,255,255,0.084)` | `border` 8.4% |
| `--dsw-alias-border-l3` | `rgba(255,255,255,0.156)` | `border-heavy` 15.6% |

### 3.3 品牌与主按钮（6 个）—— 本皮肤最有辨识度的部分

| DSH token | 值 | Synara 依据 |
| --- | --- | --- |
| `--dsw-alias-brand-primary` | `#339cff` | `--theme-accent` |
| `--dsw-alias-brand-primary-invert` | `#141414` | `sidebar-primary-foreground = surface-under` |
| `--dsw-alias-brand-text` | `#83c3ff` | `focus` 实色 `rgba(131,195,255,0.76)` 的 alpha=1 版本 |
| `--dsw-alias-button-primary-fill` | `#ffffff` | **`--primary = ink`（白底黑字 CTA）** |
| `--dsw-alias-button-primary-hover` | `#e8e8e8` | 白底 hover 微降（对称于浅色皮肤惯例） |
| `--dsw-alias-interactive-bg-active` | `rgba(255,255,255,0.15)` | `surface-active` 15% |
| `--dsw-alias-interactive-bg-hover` | `rgba(255,255,255,0.078)` | `surface-hover` 7.8% |

### 3.4 文本（3 个）

| DSH token | 值 | Synara 依据 |
| --- | --- | --- |
| `--dsw-alias-label-primary` | `#ffffff` | `ink` |
| `--dsw-alias-label-secondary` | `rgba(255,255,255,0.65)` | `muted-foreground` 65% |
| `--dsw-alias-label-tertiary` | `rgba(255,255,255,0.5)` | `subtle-foreground` 50% |

### 3.5 代码 / 滚动条 / 状态

| DSH token | 值 | Synara 依据 |
| --- | --- | --- |
| `--dsw-alias-markdown-code-block` | `rgba(255,255,255,0.025)` | `surface-fog` 2.5% |
| `--dsw-alias-markdown-inline-code` | `#1e1e1e` | fog 2.5% 叠 surface |
| `--dsw-alias-scrollbar-bg-l1` | `rgba(255,255,255,0.07)` | scrollbar thumb 实测 |
| `--dsw-alias-scrollbar-hover-l1` | `rgba(255,255,255,0.14)` | thumb hover 实测 |
| `--dsw-alias-state-error-primary` | `#ff6764` | `destructive` |
| `--dsw-alias-state-success-primary` | `#40c977` | `success` |
| `--dsw-alias-state-warn-primary` | `#ff8549` | `warning` |

### 3.6 specific 组件（6 个）

| DSH token | 值 | Synara 依据 |
| --- | --- | --- |
| `--dsw-specific-bubble` | `#1f1f1f` | 气泡 = layer-2（对话行浮于 surface） |
| `--dsw-specific-input-major` | `rgba(45,45,45,0.96)` | `input-fill` 实测 |
| `--dsw-specific-menu` | `rgba(54,54,54,0.96)` | `menu` 玻璃实测 |
| `--dsw-specific-sidebar-fill` | `#141414` | `sidebar = surface-under`（= bg-base ✓） |
| `--dsw-specific-sidebar-nav-item-active` | `#202020` | surface-under + 5.2% selected 等效 |
| `--dsw-specific-sidebar-nav-item-hover` | `#262626` | surface-under + 7.8% hover 等效 |

---

## 4. 亮色版本：Synara Day

### 4.1 为什么需要对应亮色

Synara 的 seed 契约是**双主题**的：`:root`（亮色）与 `:root.dark`（暗色）
各自独立定义 4 个 seed。亮色不是暗色的反相，而是一套独立打磨的值——
最明显的差异是 **accent 加深为 `#0d6efd`**（暗色用 `#339cff`），
以及主按钮从「白底黑字」反转为「黑底白字」（`--primary: var(--ink)` 不变，
但 ink 本身是 `#141414`）。因此对应亮色皮肤不是「反色 Night」，而是
从 `:root` 块逐 token 重新映射。

### 4.2 亮色 token 探索结果（实测值）

| Synara token | 值 | 用途 |
| --- | --- | --- |
| `--theme-surface` | `#ffffff` | 主表面 |
| `--theme-surface-under` | `#f4f4f4` | 下层表面（侧栏） |
| `--theme-ink` | `#141414` | 墨色（文字） |
| `--theme-accent` | `#0d6efd` | 强调色（亮色下加深） |
| `--popover` | `color-mix(surface 96%, ink)` ≈ `#f4f4f4` | 浮层实色（oklab 精确值） |
| `--menu` | `popover 96% + transparent` ≈ `rgba(244,244,244,0.96)` | 菜单玻璃 |
| `--input-fill` | ink 3.5% | 输入框填充 |
| `--focus` | accent 76% → `rgba(13,110,253,0.76)` | 聚焦蓝色细线 |
| `--destructive` / `--success` / `--warning` | `#ba2623` / `#008635` / `#d97706` | 状态色（亮色加深） |
| scrollbar thumb / hover | `rgba(0,0,0,0.1)` / `0.18` | 亮色滚动条 |

### 4.3 亮色映射表

| DSH token | 值 | Synara 依据 |
| --- | --- | --- |
| `--dsw-alias-bg-base` | `#f4f4f4` | `surface-under` |
| `--dsw-alias-bg-layer-1` | `#ffffff` | `surface` |
| `--dsw-alias-bg-layer-2` | `#fbfbfb` | surface→popover 1/3 插值 |
| `--dsw-alias-bg-layer-3` | `#f8f8f8` | surface→popover 2/3 插值 |
| `--dsw-alias-bg-overlay` | `#f4f4f4` | `popover` oklab 精确值 |
| `--dsw-alias-bg-module-platform` | `#ffffff` | `surface` |
| `--dsw-alias-border-l1/l2/l3` | `rgba(20,20,20,0.042/0.084/0.156)` | border-light/border/heavy |
| `--dsw-alias-brand-primary` | `#0d6efd` | `--theme-accent`（亮色加深版） |
| `--dsw-alias-brand-primary-invert` | `#ffffff` | accent 上的反色（亮底深字/蓝底白字） |
| `--dsw-alias-brand-text` | `#0d6efd` | `focus`（accent 76% alpha 的 RGB 即 accent） |
| `--dsw-alias-button-primary-fill` | `#141414` | **`--primary = ink`（黑底白字 CTA）** |
| `--dsw-alias-button-primary-hover` | `#2f2f2f` | 黑底 hover 微亮 |
| `--dsw-alias-interactive-bg-active/hover` | `rgba(20,20,20,0.15/0.078)` | surface-active/hover |
| `--dsw-alias-label-primary/secondary/tertiary` | `#141414` / ink 65% / ink 50% | ink / muted / subtle |
| `--dsw-alias-markdown-code-block` | `rgba(20,20,20,0.025)` | fog 2.5% |
| `--dsw-alias-markdown-inline-code` | `#f9f9f9` | fog 2.5% 叠 surface |
| `--dsw-alias-scrollbar-bg-l1/hover-l1` | `rgba(0,0,0,0.1/0.18)` | 亮色滚动条实测 |
| `--dsw-alias-state-error/success/warn` | `#ba2623` / `#008635` / `#d97706` | destructive/success/warning |
| `--dsw-specific-bubble` | `#fbfbfb` | 气泡 = layer-2 |
| `--dsw-specific-input-major` | `rgba(20,20,20,0.035)` | `input-fill` 3.5% |
| `--dsw-specific-menu` | `rgba(244,244,244,0.96)` | `menu` 玻璃 |
| `--dsw-specific-sidebar-fill` | `#f4f4f4` | sidebar = surface-under（= bg-base ✓） |
| `--dsw-specific-sidebar-nav-item-active/hover` | `#e8e8e8` / `#e3e3e3` | surface-under + 5.2% / 7.8% |

### 4.4 注册条目

```ts
Object.freeze({
  id: 'oh-dsh-skin-synara-day',
  colorScheme: 'light',
  tokens: SYNARA_DAY_TOKENS,
  preview: 'linear-gradient(145deg, #f4f4f4 0 38%, #ffffff 40% 62%, #0d6efd 150%)',
  accent: '#0d6efd',
  label: 'skins.name.synara-day',
}),
```

---

## 5. 实现

### 5.1 代码改动（Night + Day 共 4 处）

| 文件 | 改动 |
| --- | --- |
| `plugins/desktop-skins/src/preferences.ts` | `DESKTOP_SKIN_IDS` 追加 `'oh-dsh-skin-synara-night'` 与 `'oh-dsh-skin-synara-day'` |
| `plugins/desktop-skins/src/client/skins.ts` | 新增 `SYNARA_NIGHT_TOKENS` / `SYNARA_DAY_TOKENS` 常量 + `DESKTOP_SKINS` 条目 |
| `plugins/desktop-skins/src/client/i18n.ts` | `skins.name.synara-night` / `skins.name.synara-day`（en/zh） |
| `tests/desktop-skins.test.ts` | `DESKTOP_SKINS.length` 4 → 6 |

### 5.2 Night 注册条目

```ts
Object.freeze({
  id: 'oh-dsh-skin-synara-night',
  colorScheme: 'dark',
  tokens: SYNARA_NIGHT_TOKENS,
  preview: 'linear-gradient(145deg, #141414 0 38%, #2d2d2d 40% 62%, #339cff 150%)',
  accent: '#339cff',
  label: 'skins.name.synara-night',
}),
```

- `preview`：石墨灰 → 中灰 → 蓝的渐变，直观表达「中性灰阶 + 蓝细线」。
- `accent`：`#339cff`，与品牌主色一致。

### 5.3 设计说明（与原有皮肤刻意不同）

1. **主按钮是白底黑字**，不是品牌色填充——这是 Synara 的 signature
   （`--primary: var(--ink)`），也是这套皮肤与深海流光/翡翠回路最直观的区别。
2. **背景近中性**：所有层级都在 `#141414→#2d2d2d` 的纯灰区间，蓝色只出现在
   品牌、链接与聚焦线上——符合 Synara「灰度界面 + 蓝色细线」的工程审美。
3. **代码块极淡**：fog 2.5% 而非深色块，配合 DSH 自身的 markdown 渲染。
4. **状态色独立**：error/success/warning 不向色相妥协（`#ff6764/#40c977/#ff8549`），
   因为 Synara 把它们视为语义信号而非装饰。

---

## 6. 验证

```sh
pnpm test          # 51 个测试全过（含 desktop-skins.test.ts 6 套皮肤断言）
pnpm typecheck     # tsc --noEmit 无错误
pnpm run check:skins  # 逐 token 核对：从 Synara 源码推导期望值与 skins.ts 实际值比对
```

`check:skins` 使用 `scripts/verify-skin-tokens.mjs`：对 Night/Day 两套皮肤
的 32 个 token 逐一断言（背景插值、border alpha、状态 hex、sidebar 叠加、
滚动条、menu 玻璃等），任何一处复刻偏差都会以 `实际 vs 期望` 形式报出。

皮肤在应用中生效路径：设置 → 通用 → Desktop skin → Synara 夜色 / Synara 晨曦。
选择后立即应用；重新启动由 Host 持久化（`desktop-skins.json`）。
暗/亮两套皮肤与系统外观独立——选择哪套就固定使用哪套，不受
`light/dark/system` 官方外观影响（切回「原始外观」才会回到官方外观）。

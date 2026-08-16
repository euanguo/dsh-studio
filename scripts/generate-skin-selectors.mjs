// 精确类名生成器：扫描上游构建产物，把皮肤几何 CSS 的语义后缀锚点
// （[class*="_trigger"] 等）替换为 CSS Modules 精确哈希类名。
//
// 设计（docs/SKINS-BUILD-TIME-ARCHITECTURE.md §5/§8.1）：
//   - 扫描目标：.cache/dsh-source/<rev>/apps/web/dist/assets/*.{css,js}
//     （web 壳 + 官方 ui-primitives 的编译产物）与 packages/*/*/lib/client.js
//     （官方 client 插件 bundle，内联 css 字符串）；.cache 为权威源。
//   - 类名提取：css 文件取全部 `.Token`；js 文件只在「点号前缀 + 非函数调用」
//     语境提取（内联 css 字符串必然满足，JS 标识符噪声如 .unstable_wrapCallback(
//     因后随 "(" 被排除）。
//   - 语义后缀清单跟随 CHATGPT_GEOMETRY_CSS 的锚点演进；零命中 → 抛错
//     （把静默视觉损坏变成响亮构建失败）。
//   - 输出 plugins/desktop-skins/src/client/generated-selectors.ts（入库，
//     diff 可审；上游 bump 后重跑本脚本重新生成是预期行为）。
//
// 用法：
//   node scripts/generate-skin-selectors.mjs            # 重新生成（幂等）
//   node scripts/generate-skin-selectors.mjs --check    # 只校验已入库文件
//   node scripts/generate-skin-selectors.mjs --check --if-present
//        # 校验但产物缺失时跳过（build.mjs 在 clean checkout 下使用：
//        # CI 的 `pnpm run build` 先于 build:dsh 运行，此时无 .cache）
//   node scripts/generate-skin-selectors.mjs --list     # 打印命中统计，不写文件
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshSource, resolveDshSourceIfPresent } from './dsh-source.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = join(root, 'plugins', 'desktop-skins', 'src', 'client', 'generated-selectors.ts')

/**
 * 锚点规格：name = 生成常量名；patterns = 类名需包含的子串（任一命中）；
 * excludes = 类名包含任一子串则剔除。语义与旧子串选择器一一对应：
 *   [class*="X"]:not([class*="A"]):not([class*="B"])  ≡  patterns:['X'], excludes:['A','B']
 * BUTTON_MD 特殊：组件元素同时挂 `_button_` 与 `_md` 两类，输出为
 * 「按钮类 × 尺寸类」组合选择器（等价旧 [class*="_button_"][class*="_md"]）。
 */
const ANCHORS = [
  { name: 'MENU_LIST', patterns: ['_list_', '_submenu_'] },
  { name: 'MENU_SURFACE', patterns: ['_menu'], excludes: ['menuOpen', 'menuStatus'] },
  { name: 'MENU_ITEM', patterns: ['_item_'] },
  { name: 'ITEM_WRAP', patterns: ['_itemWrap'] },
  { name: 'ITEM_LABEL', patterns: ['_itemLabel'] },
  { name: 'NAV_CELL', patterns: ['_navCell'] },
  { name: 'TRIGGER_PILL', patterns: ['_trigger'], excludes: ['_triggerLabel', '_triggerEffort', '_triggerIcon'] },
  { name: 'TRIGGER_LABEL', patterns: ['_triggerLabel'] },
  { name: 'TRIGGER_EFFORT', patterns: ['_triggerEffort'] },
  { name: 'TRIGGER_ICON', patterns: ['_triggerIcon'] },
  { name: 'SEAT', patterns: ['_seat'], excludes: ['_seatIcon'] },
  { name: 'WORKSPACE_PILL', patterns: ['_workspace'], excludes: ['_workspaceLabel'] },
  { name: 'WORKSPACE_LABEL', patterns: ['_workspaceLabel'] },
  { name: 'GROUP_LABEL', patterns: ['_label_'] },
  { name: 'SELECTOR', patterns: ['_selector'] },
  { name: 'NEW_SESSION', patterns: ['_newSession'], excludes: ['_newSessionLabel'] },
  { name: 'SESSION_ROW', patterns: ['_sessionRow'] },
  { name: 'PROJECT_ROW', patterns: ['_projectRow'] },
  { name: 'WORKSPACE_ROW', patterns: ['_workspaceRow'] },
  { name: 'CARD', patterns: ['_card'] },
  { name: 'DIALOG', patterns: ['_dialog'] },
  { name: 'RENAME_INPUT', patterns: ['_renameInput'] },
  { name: 'THEME_CUBE', patterns: ['_themeCube'] },
  // 实心主操作键：`_primary` 类但排除 Button 组件体系（组件元素同时挂
  // `_button_` 与 `_primary` 两个类——旧子串规则 :not([class*="_button_"])
  // 是元素级排除，类名减法表达不了，必须在生成期把按钮类逐个钉成
  // :not(._button_xxx)，见 resolveAnchors 的 primaryPill 特判）。
  { name: 'PRIMARY_PILL', patterns: ['_primary'], excludeClasses: ['_button_'] },
  { name: 'BUTTON_CLASS', patterns: ['_button_'] },
  { name: 'WRAP', patterns: ['_wrap'] },
  { name: 'ICON', patterns: ['_icon'] },
  { name: 'BUTTON_MD', combined: true, patterns: ['_button_', '_md'] },
]

/** 收集一次扫描的全部候选类名（去重、排序）。 */
function collectClasses(source) {
  const files = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.endsWith('.map')) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.(css|js)$/.test(entry.name)) files.push(path)
    }
  }
  const assets = join(source, 'apps', 'web', 'dist', 'assets')
  if (existsSync(assets)) walk(assets)
  const packages = join(source, 'packages')
  if (existsSync(packages)) walk(packages)
  const classes = new Set()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    // css 文件直接扫全部点号类名；js 文件只扫「含 { 的字符串字面量」——
    // 官方 client bundle 的组件样式是内联 css 字符串（.foo{...}），
    // JS 标识符噪声（e._wrapperState、n.unstable_wrapCallback 等属性访问）
    // 不在任何 css 字符串里，天然被排除。
    const sources = file.endsWith('.css')
      ? [text]
      : [...text.matchAll(/"([^"\\\n]|\\.)*"|'([^'\\\n]|\\.)*'|`([^`\\]|\\.)*`/g)]
          .map(match => match[0])
          .filter(string => string.includes('{'))
    for (const source of sources) {
      for (const match of source.matchAll(/\.([A-Za-z0-9_-]+)/g)) {
        const token = match[1]
        if (token.length === 0 || !/[A-Za-z]/.test(token)) continue
        classes.add(token)
      }
    }
  }
  return [...classes].sort()
}

function resolveAnchors(classes) {
  const result = {}
  for (const anchor of ANCHORS) {
    if (anchor.combined === true) {
      // 组合锚点：按钮类 × 尺寸类（同一元素同挂两类才命中旧规则）。
      const buttonClasses = classes.filter(c => anchor.patterns[0] && c.includes(anchor.patterns[0]))
      const sizeClasses = classes.filter(c => c.includes(anchor.patterns[1]))
      const pairs = []
      for (const button of buttonClasses) {
        for (const size of sizeClasses) {
          pairs.push(`.${button}.${size}`)
        }
      }
      result[anchor.name] = pairs
      continue
    }
    result[anchor.name] = classes
      .filter(c => anchor.patterns.some(p => c.includes(p)))
      .filter(c => !(anchor.excludes ?? []).some(e => c.includes(e)))
      .map(c => `.${c}`)
    if (anchor.excludeClasses !== undefined) {
      // 元素级排除：把每个排除类钉成 :not(._button_xxx)（精确等价旧
      // [class*="_primary"]:not([class*="_button_"]) 的元素级语义）。
      const excluded = classes
        .filter(c => anchor.excludeClasses.some(e => c.includes(e)))
        .map(c => `:not(.${c})`)
      result[anchor.name] = result[anchor.name].map(selector => selector + excluded.join(''))
    }
  }
  return result
}

function resolveSource() {
  // 先探测不克隆；产物缺失时 --check --if-present 直接跳过。
  const present = resolveDshSourceIfPresent()
  if (present !== undefined) return present
  const source = resolveDshSource()
  const marker = join(source, 'apps', 'web', 'dist', 'assets')
  if (!existsSync(marker)) {
    throw new Error(
      `DSH build artifacts are missing at ${source}; run pnpm run build:dsh first`,
    )
  }
  return source
}

function renderModule(source, anchors) {
  const lines = [
    '// Auto-generated by scripts/generate-skin-selectors.mjs — do not edit by hand.',
    `// Sources: ${source} (apps/web/dist/assets + packages/*/*/lib/client.js)`,
    '//',
    '// Each constant is the exact CSS Modules class list for one semantic',
    '// geometry anchor of the ChatGPT skin (see CHATGPT_GEOMETRY_CSS).',
    '// Regenerate after an upstream DSH bump: pnpm run generate:selectors',
    '//',
  ]
  for (const anchor of ANCHORS) {
    const list = anchors[anchor.name]
    lines.push(`export const ${anchor.name} = Object.freeze([`)
    for (const selector of list) lines.push(`  '${selector}',`)
    lines.push(`] as const)`)
    lines.push('')
  }
  return lines.join('\n')
}

function formatSummary(anchors) {
  return ANCHORS.map(a => `${a.name}: ${anchors[a.name].length}`).join(' · ')
}

function main() {
  const args = process.argv.slice(2)
  const checkOnly = args.includes('--check')
  const ifPresent = args.includes('--if-present')
  const listOnly = args.includes('--list')
  let source
  try {
    source = resolveSource()
  } catch (error) {
    if (checkOnly && ifPresent) {
      console.log('· skin selector check skipped: DSH build artifacts not present yet')
      return
    }
    throw error
  }
  const classes = collectClasses(source)
  const anchors = resolveAnchors(classes)
  const failures = []
  for (const anchor of ANCHORS) {
    if (anchors[anchor.name].length === 0) {
      failures.push(`zero hits for anchor ${anchor.name} (${anchor.patterns.join('|')})`)
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `skin selector generator found ${failures.length} empty anchor(s):\n${failures.join('\n')}`,
    )
  }
  const rendered = renderModule(source, anchors)
  if (checkOnly) {
    const committed = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : ''
    if (committed !== rendered) {
      throw new Error(
        'generated-selectors.ts is out of sync with the DSH build artifacts; '
        + 'run `pnpm run generate:selectors` and commit the diff',
      )
    }
    console.log(`✓ generated-selectors.ts is in sync (${formatSummary(anchors)})`)
    return
  }
  if (listOnly) {
    console.log(formatSummary(anchors))
    return
  }
  writeFileSync(outputPath, rendered)
  console.log(`✓ wrote ${outputPath}`)
  console.log(`  ${formatSummary(anchors)}`)
}

main()

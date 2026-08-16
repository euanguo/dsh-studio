// 上游官方组件样式审计提取器：把 web shell css + packages client bundle 内联
// css 全量解析成「模块 → 类名 → 关键规则」，并对拍 ChatGPT 皮肤覆盖清单。
//
// 用法：
//   node scripts/audit-skin-styles.mjs [--json <out.json>] [--module <prefix>]
//   --module 只输出指定模块（如 --module 19372），便于逐个过
//
// 关键属性：border-radius / height / min-height / max-height / padding* /
// font-size / line-height / background* / color / border* / box-shadow /
// backdrop-filter / opacity。颜色类值（非 var()）单列，便于找硬编码。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDshSourceIfPresent } from './dsh-source.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const KEY_PROPS = new Set([
  'border-radius', 'height', 'min-height', 'max-height', 'padding', 'padding-top',
  'padding-right', 'padding-bottom', 'padding-left', 'padding-block', 'padding-inline',
  'font-size', 'line-height', 'background', 'background-color', 'color', 'border',
  'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color',
  'box-shadow', 'backdrop-filter', 'opacity', 'width', 'min-width', 'gap',
])
const COLOR_VALUE = /(^|[ (])(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch?\(|color-mix\()/i

/** 轻量规则级 CSS 解析（压缩产物足够）：返回 [{selector, declarations, inAtRule}] */
function parseCss(text) {
  const rules = []
  let i = 0
  const length = text.length
  const skipComment = () => { i += 2; while (i < length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2 }
  const skipString = () => {
    const quote = text[i]
    i++
    while (i < length) {
      if (text[i] === '\\') { i += 2; continue }
      if (text[i] === quote) { i++; break }
      i++
    }
  }
  const findBlockEnd = (start) => { // start 指向 '{' 之后；返回 '}' 的索引
    let depth = 0
    let j = start
    while (j < length) {
      const c = text[j]
      if (c === '{') depth++
      else if (c === '}') {
        if (depth === 0) return j
        depth--
      } else if (c === '/') {
        if (text[j + 1] === '*') { while (j < length && !(text[j] === '*' && text[j + 1] === '/')) j++; j++; continue }
      } else if (c === '"' || c === "'") {
        const quote = c; j++
        while (j < length) { if (text[j] === '\\') { j += 2; continue } if (text[j] === quote) break; j++ }
      }
      j++
    }
    return -1
  }
  const parseDeclarations = (block) => {
    const declarations = []
    let j = 0
    while (j < block.length) {
      while (j < block.length && (block[j] === ' ' || block[j] === ';')) j++
      if (j >= block.length) break
      const colon = block.indexOf(':', j)
      if (colon === -1) break
      const prop = block.slice(j, colon).trim()
      // 找声明结束：分号或块尾（括号深度跟踪）
      let k = colon + 1
      let depth = 0
      while (k < block.length) {
        const c = block[k]
        if (c === '(' || c === '[') depth++
        else if (c === ')' || c === ']') depth--
        else if (c === ';' && depth === 0) break
        else if (c === '"' || c === "'") {
          const quote = c; k++
          while (k < block.length) { if (block[k] === '\\') { k += 2; continue } if (block[k] === quote) break; k++ }
        }
        k++
      }
      const value = block.slice(colon + 1, k).trim()
      declarations.push([prop, value])
      j = k + 1
    }
    return declarations
  }
  while (i < length) {
    if (text[i] === '/' && text[i + 1] === '*') { skipComment(); continue }
    if (text[i] === '"' || text[i] === "'") { skipString(); continue }
    const open = text.indexOf('{', i)
    if (open === -1) break
    const selector = text.slice(i, open).trim()
    const end = findBlockEnd(open + 1)
    if (end === -1) break
    const block = text.slice(open + 1, end)
    const inAtRule = selector.startsWith('@')
    if (inAtRule) {
      if (selector.startsWith('@keyframes') || selector.startsWith('@font-face')) {
        i = end + 1
        continue
      }
      // @media / @supports：递归解析内部规则
      rules.push(...parseCss(block).map(r => ({ ...r, inAtRule: true })))
      i = end + 1
      continue
    }
    rules.push({ selector, declarations: parseDeclarations(block), inAtRule: false })
    i = end + 1
  }
  return rules
}

/** 从选择器提取类名 token（点号开头） */
function classTokens(selector) {
  const tokens = new Set()
  for (const m of selector.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) tokens.add(m[1])
  return [...tokens]
}

/** 类名 → 模块前缀（LqtciG_trigger → LqtciG；_item_19372_91 → 19372） */
function moduleOf(cls) {
  const parts = cls.split('_')
  if (parts[0] === '' && parts.length >= 3) return parts[2]
  return parts[0]
}

// ---- 收集 css 来源 ----
const source = resolveDshSourceIfPresent()
if (source === undefined) {
  console.error('no .cache/dsh-source artifacts; run pnpm run build:dsh first')
  process.exit(1)
}

const files = []
const walk = (dir) => {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (entry.name.endsWith('.map')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name.endsWith('.css')) files.push([path, 'web-shell'])
  }
}
walk(join(source, 'apps', 'web', 'dist', 'assets'))
// packages client bundles：css 内联在含 { 的字符串字面量里
const packageFiles = []
const walkPackages = (dir) => {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (entry.name.endsWith('.map')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'src' || entry.name === 'node_modules') continue
      walkPackages(path)
    } else if (entry.name === 'client.js' || (entry.name.endsWith('.js') && !entry.name.endsWith('.map'))) {
      packageFiles.push(path)
    }
  }
}
walkPackages(join(source, 'packages'))

// ---- 解析 ----
const modules = new Map() // modulePrefix -> {source, classes: Map<cls, {count, rules: []}>}
const tokenUsage = new Map() // --dsw-* -> count

const addRule = (selector, declarations, sourceName) => {
  const tokens = classTokens(selector)
  if (tokens.length === 0) return
  for (const cls of tokens) {
    const module = moduleOf(cls)
    let entry = modules.get(module)
    if (entry === undefined) {
      entry = { source: sourceName, classes: new Map() }
      modules.set(module, entry)
    }
    let classEntry = entry.classes.get(cls)
    if (classEntry === undefined) {
      classEntry = { count: 0, rules: [] }
      entry.classes.set(cls, classEntry)
    }
    classEntry.count++
    classEntry.rules.push({ selector, declarations })
  }
  for (const [, value] of declarations) {
    for (const m of value.matchAll(/--dsw-[a-zA-Z0-9-]+/g)) {
      tokenUsage.set(m[0], (tokenUsage.get(m[0]) ?? 0) + 1)
    }
  }
}

for (const [path, sourceName] of files) {
  const rules = parseCss(readFileSync(path, 'utf8'))
  for (const rule of rules) addRule(rule.selector, rule.declarations, sourceName)
}
for (const path of packageFiles) {
  const text = readFileSync(path, 'utf8')
  const sourceName = path.includes('/packages/')
    ? path.split('/packages/')[1].split('/lib/')[0]
    : 'pkg'
  for (const m of text.matchAll(/"([^"\\\n]|\\.)*"|'([^'\\\n]|\\.)*'|`([^`\\]|\\.)*`/g)) {
    let string = m[0]
    if (!string.includes('{')) continue
    // 去掉首尾引号并还原基本转义（压缩 css 字符串里只有 \\ 与引号转义）
    string = string.slice(1, -1).replace(/\\(["'\\])/g, '$1')
    const rules = parseCss(string)
    for (const rule of rules) addRule(rule.selector, rule.declarations, sourceName)
  }
}

// ---- 覆盖清单对拍 ----
const generated = readFileSync(
  join(root, 'plugins', 'desktop-skins', 'src', 'client', 'generated-selectors.ts'),
  'utf8',
)
const covered = new Set()
for (const m of generated.matchAll(/'\.(-?[A-Za-z_][A-Za-z0-9_-]*(?::not\([^)]*\))*)'/g)) {
  covered.add(m[1].split(':not(')[0].replace(/^\./, ''))
}
const ownLiteral = new Set(['oh-dsh-skins-tile'])

// ---- 输出 ----
const args = process.argv.slice(2)
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : undefined
const moduleFilter = args.includes('--module') ? args[args.indexOf('--module') + 1] : undefined

const summary = []
for (const [prefix, entry] of [...modules.entries()].sort()) {
  if (moduleFilter !== undefined && prefix !== moduleFilter) continue
  const classNames = [...entry.classes.keys()].sort()
  const coveredCount = classNames.filter(c => covered.has(c) || ownLiteral.has(c)).length
  const keyRules = []
  for (const cls of classNames) {
    const ce = entry.classes.get(cls)
    const interesting = ce.rules.map(rule => {
      const picked = rule.declarations.filter(([prop]) => KEY_PROPS.has(prop))
      const colors = picked.filter(([, value]) => COLOR_VALUE.test(value) && !value.includes('var('))
      return {
        selector: rule.selector,
        decl: picked,
        hardcodedColors: colors.map(([prop, value]) => `${prop}:${value}`),
      }
    }).filter(r => r.decl.length > 0)
    if (interesting.length > 0) keyRules.push({ cls, count: ce.count, rules: interesting })
  }
  summary.push({
    module: prefix,
    source: entry.source,
    classes: classNames,
    classCount: classNames.length,
    coveredCount,
    rules: keyRules,
  })
}

if (jsonOut !== undefined) {
  writeFileSync(jsonOut, JSON.stringify({ modules: summary, tokenUsage: [...tokenUsage.entries()].sort() }, null, 2))
  console.log(`wrote ${jsonOut}: ${summary.length} modules`)
  process.exit(0)
}

// 人类可读输出
for (const mod of summary) {
  console.log(`\n===== [${mod.module}] ${mod.source} · ${mod.classCount} 类 · 已覆盖 ${mod.coveredCount} =====`)
  for (const r of mod.rules) {
    const coveredMark = covered.has(r.cls) || ownLiteral.has(r.cls) ? '✓' : '·'
    console.log(`  ${coveredMark} .${r.cls} ×${r.count}`)
    for (const rule of r.rules.slice(0, 4)) {
      const decl = rule.decl.map(([p, v]) => `${p}:${v}`).join('; ')
      const hard = (rule.hardcodedColors ?? []).length > 0 ? `  ⚠️${rule.hardcodedColors.join(' ')}` : ''
      console.log(`      ${rule.selector.slice(0, 90)} { ${decl.slice(0, 200)} }`)
      if (hard) console.log(hard)
    }
  }
}
if (moduleFilter === undefined) {
  console.log(`\n===== token 引用（上游 css 里实际使用的 --dsw-*）: ${tokenUsage.size} 个 =====`)
  const uncoveredTokens = [...tokenUsage.keys()].sort()
  console.log(uncoveredTokens.join(' '))
}

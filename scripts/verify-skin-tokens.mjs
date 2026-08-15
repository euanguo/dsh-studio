// 最终核对：从 Synara theme-tokens.css 源码推导每个皮肤 token 的期望值，
// 与 plugins/desktop-skins/src/client/skins.ts 实际值比对。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---- 颜色工具 ----
const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const clamp = v => Math.min(255, Math.max(0, Math.round(v)))
const rgbToHex = (r, g, b) => '#' + [clamp(r), clamp(g), clamp(b)].map(v => v.toString(16).padStart(2, '0')).join('')
// sRGB → 线性
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const sRGB = c => { c = Math.min(1, Math.max(0, c)); return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055 }
// OKLab
const toOklab = (r, g, b) => {
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)]
  let l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb
  let m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb
  let s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb
  const [l_, m_, s_] = [Math.cbrt(l), Math.cbrt(m), Math.cbrt(s)]
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ]
}
const fromOklab = (L, a, b) => {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3]
  return [
    sRGB(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    sRGB(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    sRGB(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ].map(v => v * 255)
}
const mix = (c1, c2, p1) => { // p1 = c1 的百分比
  const [L1, a1, b1] = toOklab(...hexToRgb(c1))
  const [L2, a2, b2] = toOklab(...hexToRgb(c2))
  const p = p1 / 100
  return fromOklab(L1 * p + L2 * (1 - p), a1 * p + a2 * (1 - p), b1 * p + b2 * (1 - p))
}
// color-mix(A p%, transparent) → alpha=p% 的 A（oklab premultiplied 语义 = A 的 RGB 不变 + alpha）
// 但浏览器实际渲染为 "oklab 插值到透明(黑)再还原" 的近似，用 A 与黑 oklab 插值再除以 alpha 还原
const mixTransparent = (c, p) => {
  // CSS Color 5: transparent 插值为 premultiplied 0 → 结果 un-premultiply 后 RGB = 原色
  return { rgb: hexToRgb(c), alpha: p / 100 }
}

// ---- 皮肤文件提取 ----
const skinsSrc = readFileSync(join(root, 'plugins', 'desktop-skins', 'src', 'client', 'skins.ts'), 'utf8')
function extract(name) {
  const block = skinsSrc.split(`const ${name} = {`)[1].split('} as const')[0]
  const tokens = {}
  for (const m of block.matchAll(/'([^']+)': '([^']+)'/g)) tokens[m[1]] = m[2]
  return tokens
}
const night = extract('SYNARA_NIGHT_TOKENS')
const day = extract('SYNARA_DAY_TOKENS')

// ---- 期望值计算 ----
const N = {
  surface: '#181818', under: '#141414', ink: '#ffffff', accent: '#339cff',
}
const L = {
  surface: '#ffffff', under: '#f4f4f4', ink: '#141414', accent: '#0d6efd',
}

function checks(skin, name, s) {
  const errs = []
  const expect = (token, fn, desc) => {
    const got = skin[token]
    const want = fn()
    const ok = got === want
    if (!ok) errs.push(`  ✗ ${token}: 实际=${got} 期望=${want} (${desc})`)
  }
  // 背景层级
  expect('--dsw-alias-bg-base', () => s.under, 'surface-under')
  expect('--dsw-alias-bg-layer-1', () => s.surface, 'surface')
  // layer-2/3: surface→popover 线性 1/3、2/3（设计插值）
  const popHex = name === 'dark' ? '#2d2d2d' : rgbToHex(...mix(s.surface, s.ink, 96))
  const pop = hexToRgb(popHex)
  const base = hexToRgb(s.surface)
  const l2 = base.map((v, i) => v + (pop[i] - v) / 3)
  const l3 = base.map((v, i) => v + (pop[i] - v) * 2 / 3)
  expect('--dsw-alias-bg-layer-2', () => rgbToHex(...l2), `surface→popover(${rgbToHex(...pop)}) 1/3`)
  expect('--dsw-alias-bg-layer-3', () => rgbToHex(...l3), `surface→popover 2/3`)
  expect('--dsw-alias-bg-overlay', () => popHex, name === 'dark' ? 'popover 硬编码 rgb(45,45,45)' : 'color-mix(surface 96%, ink)')
  expect('--dsw-alias-bg-module-platform', () => s.surface, 'surface（与 layer-1 同）')
  // 边框阶梯（源码直接 alpha）
  expect('--dsw-alias-border-l1', () => `rgba(${hexToRgb(s.ink).join(', ')}, 0.042)`, 'border-light 4.2%')
  expect('--dsw-alias-border-l2', () => `rgba(${hexToRgb(s.ink).join(', ')}, 0.084)`, 'border 8.4%')
  expect('--dsw-alias-border-l3', () => `rgba(${hexToRgb(s.ink).join(', ')}, 0.156)`, 'border-heavy 15.6%')
  // 品牌
  expect('--dsw-alias-brand-primary', () => s.accent, 'accent seed')
  // brand-primary-invert: sidebar-primary-foreground = surface（light）/ surface-under（dark）
  expect('--dsw-alias-brand-primary-invert', () => name === 'dark' ? s.under : s.surface, 'sidebar-primary-foreground')
  // brand-text: dark = focus live RGB #83c3ff（源码注释实测）；light = accent
  if (name === 'dark') {
    expect('--dsw-alias-brand-text', () => '#83c3ff', 'focus live rgba(131,195,255,.76) RGB')
  } else {
    expect('--dsw-alias-brand-text', () => L.accent, 'focus = accent（76% alpha 的 RGB 即 accent）')
  }
  // 主按钮：primary = ink（白底黑字 dark / 黑底白字 light）
  expect('--dsw-alias-button-primary-fill', () => s.ink, 'primary = ink')
  // hover 为设计推导（fill 微变），仅检查存在
  // 交互
  expect('--dsw-alias-interactive-bg-active', () => `rgba(${hexToRgb(s.ink).join(', ')}, 0.15)`, 'surface-active 15%')
  expect('--dsw-alias-interactive-bg-hover', () => `rgba(${hexToRgb(s.ink).join(', ')}, 0.078)`, 'surface-hover 7.8%')
  // 文本
  expect('--dsw-alias-label-primary', () => s.ink, 'ink')
  expect('--dsw-alias-label-secondary', () => `rgba(${hexToRgb(s.ink).join(', ')}, 0.65)`, 'muted-foreground 65%')
  expect('--dsw-alias-label-tertiary', () => `rgba(${hexToRgb(s.ink).join(', ')}, 0.5)`, 'subtle-foreground 50%')
  // markdown
  expect('--dsw-alias-markdown-code-block', () => `rgba(${hexToRgb(s.ink).join(', ')}, 0.025)`, 'surface-fog 2.5%')
  // inline-code: fog 叠在 layer-1 上
  const fog = hexToRgb(s.ink)
  const layer1 = hexToRgb(s.surface)
  const inline = fog.map((v, i) => v * 0.025 + layer1[i] * 0.975)
  expect('--dsw-alias-markdown-inline-code', () => rgbToHex(...inline), 'fog 2.5% 叠 surface')
  // 滚动条（styles.css）
  if (name === 'dark') {
    expect('--dsw-alias-scrollbar-bg-l1', () => 'rgba(255, 255, 255, 0.07)', 'styles.css dark thumb')
    expect('--dsw-alias-scrollbar-hover-l1', () => 'rgba(255, 255, 255, 0.14)', 'styles.css dark hover')
  } else {
    expect('--dsw-alias-scrollbar-bg-l1', () => 'rgba(0, 0, 0, 0.1)', 'styles.css light thumb')
    expect('--dsw-alias-scrollbar-hover-l1', () => 'rgba(0, 0, 0, 0.18)', 'styles.css light hover')
  }
  // 状态色（源码 hex）
  const states = name === 'dark'
    ? { error: '#ff6764', success: '#40c977', warn: '#ff8549' }
    : { error: '#ba2623', success: '#008635', warn: '#d97706' }
  expect('--dsw-alias-state-error-primary', () => states.error, 'destructive')
  expect('--dsw-alias-state-success-primary', () => states.success, 'success')
  expect('--dsw-alias-state-warn-primary', () => states.warn, 'warning')
  // specific
  expect('--dsw-specific-bubble', () => rgbToHex(...l2), '气泡 = layer-2')
  expect('--dsw-specific-input-major', () => {
    const c = name === 'dark' ? 'rgba(45, 45, 45, 0.96)' : 'rgba(20, 20, 20, 0.035)'
    return c
  }, name === 'dark' ? 'input-fill 硬编码' : 'input-fill 3.5%')
  expect('--dsw-specific-menu', () => {
    if (name === 'dark') return 'rgba(54, 54, 54, 0.96)'
    return `rgba(${hexToRgb(popHex).join(', ')}, 0.96)`
  }, name === 'dark' ? 'menu 硬编码' : 'popover 96% 玻璃')
  expect('--dsw-specific-sidebar-fill', () => s.under, 'sidebar = surface-under')
  // nav: under + selected/hover alpha 叠加
  const sel = hexToRgb(s.ink).map((v, i) => v * 0.052 + hexToRgb(s.under)[i] * 0.948)
  const hov = hexToRgb(s.ink).map((v, i) => v * 0.078 + hexToRgb(s.under)[i] * 0.922)
  expect('--dsw-specific-sidebar-nav-item-active', () => rgbToHex(...sel), 'under + 5.2%')
  expect('--dsw-specific-sidebar-nav-item-hover', () => rgbToHex(...hov), 'under + 7.8%')

  // token 数
  const count = Object.keys(skin).length
  if (count !== 32) errs.push(`  ✗ ${name}: token 数 ${count} ≠ 32`)
  if (errs.length === 0) console.log(`✓ ${name}: 全部 ${count} 个 token 核对一致`)
  else console.log(`✗ ${name}: ${errs.length} 处不一致\n${errs.join('\n')}`)
  return errs.length
}

let bad = 0
bad += checks(night, 'dark', N)
bad += checks(day, 'light', L)
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 处需修正`)

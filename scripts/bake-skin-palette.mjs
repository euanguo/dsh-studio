// 构建期配色烘焙：把 ChatGPT 皮肤的 token 覆盖块追加到 web 壳的
// index-*.css 末尾，让内置 light/dark/system 主题原生就是 ChatGPT 配色。
//
// 设计（docs/SKINS-BUILD-TIME-ARCHITECTURE.md §3.4/§8.2）：
//   - 追加两段：亮 = chatgpt-day 值（body {}）、暗 = chatgpt-night 值
//     （body[data-ds-dark-theme] {}）。暗色块特异性更高，后追加也不会被覆盖。
//   - 单一事实源：值直接来自 plugins/desktop-skins/src/shared-tokens.ts
//     （与插件注册、token 校验同一份定义，防漂移）。
//   - 自检：追加前断言产物 css 存在 data-ds-dark-theme 与 --dsw-alias-bg-base
//     （上游改名/拆管线 → 构建报错）；追加后断言两段块都存在。
//   - 幂等：重复执行先剥离旧烘焙块再追加。
//   - 只烘焙 stage 拷贝（.stage/dsh-runtime/workspace/...），不改
//     .cache/dsh-source 的 checkout（validateSource 要求 checkout 干净）。
//
// 用法：
//   node scripts/bake-skin-palette.mjs [assetsDir]
//   （默认 .stage/dsh-runtime/workspace/apps/web/dist/assets）
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CHATGPT_DAY_COLOR_TOKENS,
  CHATGPT_DAY_TOKENS,
  CHATGPT_NIGHT_COLOR_TOKENS,
  CHATGPT_NIGHT_TOKENS,
} from '../plugins/desktop-skins/src/shared-tokens.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const BAKE_HEADER = '/* === DSH Studio: baked default palette (chatgpt-day / chatgpt-night) === */'
const BAKE_FOOTER = '/* === end DSH Studio baked palette === */'

/** 渲染一段 token 覆盖块（键按字母序，diff 友好）。 */
function renderBlock(selector, ...tokenSets) {
  const entries = new Map()
  for (const tokens of tokenSets) {
    for (const [key, value] of Object.entries(tokens)) entries.set(key, value)
  }
  const declarations = [...entries.keys()]
    .sort()
    .map(key => `  ${key}: ${entries.get(key)};`)
    .join('\n')
  return `${selector} {\n${declarations}\n}`
}

/** 生成完整的烘焙块（亮在前、暗在后，顺序与特异性都正确）。 */
export function buildBakedPalette() {
  return [
    BAKE_HEADER,
    renderBlock('body', CHATGPT_DAY_TOKENS, CHATGPT_DAY_COLOR_TOKENS),
    renderBlock('body[data-ds-dark-theme]', CHATGPT_NIGHT_TOKENS, CHATGPT_NIGHT_COLOR_TOKENS),
    BAKE_FOOTER,
    '',
  ].join('\n')
}

/** 剥离已有烘焙块（幂等）。 */
export function stripBakedPalette(css) {
  const start = css.indexOf(BAKE_HEADER)
  if (start === -1) return css
  const end = css.indexOf(BAKE_FOOTER, start)
  if (end === -1) {
    throw new Error('baked palette block header found without footer; manual review needed')
  }
  return css.slice(0, start) + css.slice(end + BAKE_FOOTER.length)
}

/**
 * 对 web 壳的 assets 目录执行烘焙（就地修改 index-*.css）。
 * @returns 烘焙后的 css 文本。
 */
export function bakeSkinPalette(assetsDir) {
  const candidates = readdirSync(assetsDir)
    .filter(name => /^index-.*\.css$/.test(name))
    .sort()
  if (candidates.length === 0) {
    throw new Error(`no index-*.css found under ${assetsDir}`)
  }
  if (candidates.length > 1) {
    throw new Error(`ambiguous web shell css under ${assetsDir}: ${candidates.join(', ')}`)
  }
  const path = join(assetsDir, candidates[0])
  const css = readFileSync(path, 'utf8')
  // 追加前自检：上游 token 管线仍是我们依赖的形状。
  if (!css.includes('data-ds-dark-theme')) {
    throw new Error('web shell css lost body[data-ds-dark-theme]; upstream token pipeline changed')
  }
  if (!css.includes('--dsw-alias-bg-base')) {
    throw new Error('web shell css lost --dsw-alias-bg-base; upstream token pipeline changed')
  }
  const baked = stripBakedPalette(css) + '\n' + buildBakedPalette()
  // 追加后自检：两段块存在、键完整。
  if (!baked.includes('body {\n') || !baked.includes('body[data-ds-dark-theme] {\n')) {
    throw new Error('baked palette self-check failed: override blocks missing after append')
  }
  for (const key of ['--dsw-alias-bg-base', '--dsw-alias-state-business-primary', '--dsw-mask-blur']) {
    if (!baked.includes(key)) throw new Error(`baked palette self-check failed: ${key} missing`)
  }
  writeFileSync(path, baked)
  return baked
}

function main() {
  const target = process.argv[2] ?? join(root, '.stage', 'dsh-runtime', 'workspace', 'apps', 'web', 'dist', 'assets')
  if (!existsSync(target)) {
    throw new Error(`bake target missing: ${target}; run pnpm run stage:dsh first (or pass an assets dir)`)
  }
  const baked = bakeSkinPalette(target)
  const light = (baked.match(/^body \{$/m)?.length ?? 0)
  const dark = (baked.match(/^body\[data-ds-dark-theme\] \{$/m)?.length ?? 0)
  console.log(`✓ baked ChatGPT palette into ${join(target, 'index-*.css')}`)
  console.log(`  light block: ${light} · dark block: ${dark} · tokens: ${(baked.match(/--dsw-(?:alias|specific)-/g) ?? []).length}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}

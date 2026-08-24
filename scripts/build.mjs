import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { resolveProductVersion } from '../src/version.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const productVersion = resolveProductVersion(root)
const versionDefine = {
  __DSH_STUDIO_BUILD_VERSION__: JSON.stringify(productVersion),
}
const nodeEsmRequireBanner = [
  "import { createRequire as __dshStudioCreateRequire } from 'node:module';",
  'const require = __dshStudioCreateRequire(import.meta.url);',
].join('\n')

// 皮肤门禁（构建期自检，见 docs/SKINS-BUILD-TIME-ARCHITECTURE.md §5.2/§9.1.3）：
//   1. token 校验 —— 官方 design-platform.css 89 键零缺失（含 Synara 既有推导）；
//   2. 精确类名对拍 —— generated-selectors.ts 与上游产物必须一致（上游 bump
//      后先跑 `pnpm run generate:selectors` 并提交 diff）；clean checkout 下
//      （.cache 未生成）跳过对拍，token 校验的官方键快照依然生效。
runNode(join('scripts', 'verify-skin-tokens.mjs'))
runNode(join('scripts', 'generate-skin-selectors.mjs'), ['--check', '--if-present'])
// Generated CSS-module class maps (desktop-left-rail + sidebar styles.ts)
// must match the module CSS sources; rebuilds fail loudly when a
// regeneration is due.
runNode(join('scripts', 'plugin-styles.mjs'), ['desktop-left-rail', '--check'])
runNode(join('scripts', 'plugin-styles.mjs'), ['sidebar', '--check'])
runNode(join('scripts', 'plugin-styles.mjs'), ['plugin-marketplace', '--check'])
runNode(join('scripts', 'plugin-styles.mjs'), ['desktop-skins', '--check'])
// The hand-maintained @dsh-studio/shared exports map must not dangle.
runNode(join('scripts', 'verify-shared-exports.mjs'))

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [join(root, script), ...args], {
    cwd: root,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`${script} failed with status ${String(result.status)}`)
  }
}

rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
// Static entry files go back IMMEDIATELY after the clean: scripts/dev.mjs
// restarts Electron from dist events without waiting for this build, and the
// app's first load is splash.html — copying it last left a whole-build window
// where a concurrent dev restart spawned Electron into ERR_FILE_NOT_FOUND.
copyFileSync(join(root, 'src', 'splash.html'), join(dist, 'splash.html'))
copyFileSync(join(root, 'src', 'update.html'), join(dist, 'update.html'))

const pluginPackages = [
  { directory: 'capabilities', hostOnly: true },
  { directory: 'tui', hostOnly: true },
  { directory: 'desktop-skins', id: '@dsh-studio/desktop-skins' },
  { directory: 'sidebar', id: '@dsh-studio/sidebar' },
  { directory: 'sidebar-desktop', id: '@dsh-studio/sidebar-desktop' },
  { directory: 'desktop-left-rail', id: '@dsh-studio/desktop-left-rail' },
  { directory: 'panel-controls', id: '@dsh-studio/panel-controls' },
  { directory: 'pinned-summary', id: '@dsh-studio/pinned-summary' },
  { directory: 'plugin-marketplace', id: '@dsh-studio/plugin-marketplace' },
]

const shared = {
  bundle: true,
  define: versionDefine,
  logLevel: 'info',
  sourcemap: true,
  target: 'node24',
}

const builds = [
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'main.ts')],
    outfile: join(dist, 'main.js'),
    platform: 'node',
    format: 'esm',
    external: ['electron'],
    banner: { js: nodeEsmRequireBanner },
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'update-preload.ts')],
    outfile: join(dist, 'update-preload.cjs'),
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    bundle: true,
    entryPoints: [join(root, 'src', 'update-dialog.ts')],
    outfile: join(dist, 'update-dialog.js'),
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
    logLevel: 'info',
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'preload.ts')],
    outfile: join(dist, 'preload.cjs'),
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'plugin.ts')],
    outfile: join(dist, 'plugin.js'),
    platform: 'node',
    format: 'esm',
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'web-entry.ts')],
    outfile: join(dist, 'web.js'),
    platform: 'node',
    format: 'esm',
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'src', 'cli.ts')],
    outfile: join(dist, 'dsh-studio.js'),
    platform: 'node',
    format: 'esm',
  }),
  build({
    ...shared,
    entryPoints: [join(root, 'web', 'src', 'index.ts')],
    outfile: join(dist, 'web', 'index.js'),
    platform: 'node',
    format: 'esm',
  }),
  build({
    bundle: true,
    define: versionDefine,
    entryPoints: [join(root, 'web', 'src', 'client.ts')],
    outfile: join(dist, 'web', 'client.js'),
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    sourcemap: true,
    logLevel: 'info',
    banner: {
      js: 'window.__ModuleLoader__.load({ id: "@dsh-studio/web", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
    },
    footer: { js: 'return module.exports; } });' },
  }),
  build({
    bundle: true,
    define: versionDefine,
    entryPoints: [join(root, 'src', 'client.ts')],
    outfile: join(dist, 'client.js'),
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    sourcemap: true,
    logLevel: 'info',
    banner: {
      js: 'window.__ModuleLoader__.load({ id: "@dsh-studio/desktop", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
    },
    footer: { js: 'return module.exports; } });' },
  }),
]

for (const plugin of pluginPackages) {
  const source = join(root, 'plugins', plugin.directory, 'src')
  const output = join(dist, 'plugins', plugin.directory)
  const hostEntry = join(source, 'index.ts')
  builds.push(build({
    ...shared,
    entryPoints: [hostEntry],
    outfile: join(output, 'index.js'),
    platform: 'node',
    format: 'esm',
    external: plugin.external ?? (plugin.directory === 'capabilities'
      ? ['@deepseek-ai/*', 'cordis', 'node-pty', 'schemastery', 'ws', 'zod']
      : []),
  }))
  if (plugin.hostOnly !== true) {
    builds.push(build({
      bundle: true,
      define: versionDefine,
      entryPoints: [join(source, 'client.ts')],
      outfile: join(output, 'client.js'),
      platform: 'browser',
      format: 'cjs',
      target: 'es2022',
      sourcemap: true,
      logLevel: 'info',
      loader: { '.css': 'text' },
      external: [
        ...(plugin.clientExternal ?? []),
        'react',
        'react-dom/client',
        'react/jsx-runtime',
        ...(['desktop-skins', 'sidebar', 'desktop-left-rail'].includes(plugin.directory)
          ? ['@deepseek-ai/dsh-client-runtime/client']
          : []),
        '@deepseek-ai/dsh-client-ui-primitives',
      ],
      banner: {
        js: `window.__ModuleLoader__.load({ id: "${plugin.id}", factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
      },
      footer: { js: 'return module.exports; } });' },
    }))
  }
}

// Lazy chunks served by the capabilities /capabilities/bundle route. The chunk
// file must live in the host's lib directory (`dist/plugins/capabilities`).
builds.push(build({
  bundle: true,
  entryPoints: [join(root, 'plugins', 'sidebar', 'src', 'client', 'files', 'mermaid-chunk.ts')],
  outfile: join(root, 'dist', 'plugins', 'capabilities', 'client-mermaid.js'),
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
  loader: { '.css': 'text' },
  external: ['react', 'react-dom/client', 'react/jsx-runtime'],
}))

// Pierre highlight worker (module worker). The client bundle is emitted in
// cjs module-factory format where import.meta is empty, so the worker is
// built as its own ESM chunk and loaded from the bundle route's absolute
// path (see pierre-adapter.tsx createPierreDiffWorker). `ignoreAnnotations`
// keeps the side-effect import alive — the package's `sideEffects` list does
// not cover the worker file, but its top-level code is what registers the
// worker message handlers.
builds.push(build({
  bundle: true,
  entryPoints: [join(root, 'plugins', 'sidebar', 'src', 'client', 'diff', 'pierre-worker-entry.ts')],
  outfile: join(root, 'dist', 'plugins', 'capabilities', 'client-pierre-worker.js'),
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
  ignoreAnnotations: true,
}))

// Chunk scripts build first (serially): esbuild instances can race when
// many builds write into the same output directory concurrently, and the
// capabilities chunks are required by the running app (diff worker,
// mermaid viewer).
for (const chunkBuild of builds.splice(-2)) {
  await chunkBuild
}
await Promise.all(builds)

const mainBundle = readFileSync(join(dist, 'main.js'), 'utf8')
if (mainBundle.includes('Dynamic require of')
  && !mainBundle.includes('__dshStudioCreateRequire(import.meta.url)')) {
  throw new Error('desktop main bundle has dynamic requires without an ESM require bridge')
}

// splash.html / update.html are copied right after the dist clean (see the
// top of this script); only the manifest and patch layers remain here.
copyFileSync(join(root, 'cordis.patch.yml'), join(dist, 'cordis.patch.yml'))
const releaseManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
releaseManifest.version = productVersion
writeFileSync(
  join(dist, 'release-package.json'),
  `${JSON.stringify(releaseManifest, undefined, 2)}\n`,
)
mkdirSync(join(dist, 'web'), { recursive: true })
copyFileSync(join(root, 'web', 'cordis.patch.yml'), join(dist, 'web', 'cordis.patch.yml'))
mkdirSync(join(dist, 'plugins', 'tui'), { recursive: true })
copyFileSync(
  join(root, 'plugins', 'tui', 'cordis.patch.yml'),
  join(dist, 'plugins', 'tui', 'cordis.patch.yml'),
)

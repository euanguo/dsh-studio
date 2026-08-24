import { join } from 'node:path'

/**
 * Shared esbuild options for every DSH Studio desktop artifact. Single source of
 * truth for `scripts/build.mjs` (one-shot release build) and
 * `scripts/dev.mjs` (hot-reload watch build).
 * @param root - repository root.
 * @returns esbuild build option list (without `watch`, which only dev.mjs adds).
 */
const nodeEsmRequireBanner = [
  "import { createRequire as __dshStudioCreateRequire } from 'node:module';",
  'const require = __dshStudioCreateRequire(import.meta.url);',
].join('\n')

export function desktopBuilds(root) {
  const pluginPackages = [
    { directory: 'capabilities', hostOnly: true },
    { directory: 'desktop-skins', id: '@dsh-studio/desktop-skins' },
    { directory: 'sidebar', id: '@dsh-studio/sidebar' },
    { directory: 'desktop-left-rail', id: '@dsh-studio/desktop-left-rail' },
    { directory: 'panel-controls', id: '@dsh-studio/panel-controls' },
    { directory: 'pinned-summary', id: '@dsh-studio/pinned-summary' },
    { directory: 'plugin-marketplace', id: '@dsh-studio/plugin-marketplace' },
    { directory: 'sidebar-desktop', id: '@dsh-studio/sidebar-desktop' },
  ]

  const shared = {
    bundle: true,
    logLevel: 'info',
    sourcemap: true,
    target: 'node24',
  }

  const builds = [
    {
      ...shared,
      entryPoints: [join(root, 'src', 'main.ts')],
      outfile: join(root, 'dist', 'main.js'),
      platform: 'node',
      format: 'esm',
      external: ['electron'],
      banner: { js: nodeEsmRequireBanner },
    },
    {
      ...shared,
      entryPoints: [join(root, 'src', 'preload.ts')],
      outfile: join(root, 'dist', 'preload.cjs'),
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
    },
    {
      ...shared,
      entryPoints: [join(root, 'src', 'plugin.ts')],
      outfile: join(root, 'dist', 'plugin.js'),
      platform: 'node',
      format: 'esm',
    },
    {
      bundle: true,
      entryPoints: [join(root, 'src', 'client.ts')],
      outfile: join(root, 'dist', 'client.js'),
      platform: 'browser',
      format: 'cjs',
      target: 'es2022',
      sourcemap: true,
      logLevel: 'info',
      banner: {
        js: 'window.__ModuleLoader__.load({ id: "@dsh-studio/desktop", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
      },
      footer: { js: 'return module.exports; } });' },
    },
  ]

  for (const plugin of pluginPackages) {
    const source = join(root, 'plugins', plugin.directory, 'src')
    const output = join(root, 'dist', 'plugins', plugin.directory)
    const hostEntry = join(source, 'index.ts')
    builds.push({
      ...shared,
      entryPoints: [hostEntry],
      outfile: join(output, 'index.js'),
      platform: 'node',
      format: 'esm',
      external: plugin.directory === 'capabilities'
        ? ['@deepseek-ai/*', 'cordis', 'node-pty', 'schemastery', 'ws', 'zod']
        : [],
    })
    if (plugin.hostOnly !== true) {
      builds.push({
        bundle: true,
        entryPoints: [join(source, 'client.ts')],
        outfile: join(output, 'client.js'),
        platform: 'browser',
        format: 'cjs',
        target: 'es2022',
        sourcemap: true,
        logLevel: 'info',
        loader: { '.css': 'text' },
        external: [
          'react',
          'react-dom/client',
          'react/jsx-runtime',
          ...(['desktop-skins', 'sidebar', 'desktop-left-rail'].includes(plugin.directory)
            ? ['@deepseek-ai/dsh-client-runtime/client']
            : []),
          // Platform seed (frozen module table): every client plugin may
          // import official primitives. The runtime resolves one copy.
          '@deepseek-ai/dsh-client-ui-primitives',
        ],
        banner: {
          js: `window.__ModuleLoader__.load({ id: "${plugin.id}", factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
        },
        footer: { js: 'return module.exports; } });' },
      })
    }
  }

  // Lazy chunks served by the capabilities /capabilities/bundle route. The chunk
  // file must live in the host's lib directory (`dist/plugins/capabilities`).
  builds.push({
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
  })

  // Pierre highlight worker (module worker). The client bundle is emitted in
  // cjs module-factory format where import.meta is empty, so the worker is
  // built as its own ESM chunk and loaded from the bundle route's absolute
  // path (see pierre-adapter.tsx createPierreDiffWorker). `ignoreAnnotations`
  // keeps the side-effect import alive — the package's `sideEffects` list does
  // not cover the worker file, but its top-level code is what registers the
  // worker message handlers.
  builds.push({
    bundle: true,
    entryPoints: [join(root, 'plugins', 'sidebar', 'src', 'client', 'diff', 'pierre-worker-entry.ts')],
    outfile: join(root, 'dist', 'plugins', 'capabilities', 'client-pierre-worker.js'),
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    sourcemap: true,
    logLevel: 'info',
    ignoreAnnotations: true,
  })

  return builds
}

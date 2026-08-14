import { join } from 'node:path'

/**
 * Shared esbuild options for every Oh-DSH desktop artifact. Single source of
 * truth for `scripts/build.mjs` (one-shot release build) and
 * `scripts/dev.mjs` (hot-reload watch build).
 * @param root - repository root.
 * @returns esbuild build option list (without `watch`, which only dev.mjs adds).
 */
export function desktopBuilds(root) {
  const pluginPackages = [
    { directory: 'better-sidebar-runtime', hostOnly: true },
    { directory: 'desktop-skins', id: '@oh-dsh/desktop-skins' },
    { directory: 'desktop-sidebar', id: '@oh-dsh/desktop-sidebar' },
    { directory: 'panel-controls', id: '@oh-dsh/panel-controls' },
    { directory: 'pinned-summary', id: '@oh-dsh/pinned-summary' },
    { directory: 'plugin-marketplace', id: '@oh-dsh/plugin-marketplace' },
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
        js: 'window.__ModuleLoader__.load({ id: "@oh-dsh/desktop", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
      },
      footer: { js: 'return module.exports; } });' },
    },
  ]

  for (const plugin of pluginPackages) {
    const source = join(root, 'plugins', plugin.directory, 'src')
    const output = join(root, 'dist', 'plugins', plugin.directory)
    const hostEntry = plugin.directory === 'better-sidebar-runtime'
      ? join(root, '..', 'DSH-better-sidebar', 'src', 'index.ts')
      : join(source, 'index.ts')
    builds.push({
      ...shared,
      entryPoints: [hostEntry],
      outfile: join(output, 'index.js'),
      platform: 'node',
      format: 'esm',
      external: plugin.directory === 'better-sidebar-runtime'
        ? ['@deepseek-ai/*', 'cordis', 'node-pty', 'schemastery', 'ws']
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
          ...(['desktop-skins', 'desktop-sidebar'].includes(plugin.directory)
            ? ['@deepseek-ai/dsh-client-runtime/client']
            : []),
        ],
        banner: {
          js: `window.__ModuleLoader__.load({ id: "${plugin.id}", factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
        },
        footer: { js: 'return module.exports; } });' },
      })
    }
  }

  return builds
}

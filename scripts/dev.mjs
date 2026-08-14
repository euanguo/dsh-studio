#!/usr/bin/env node
/**
 * Hot-reload dev launcher for Oh-DSH-Desktop.
 *
 * Three moving parts, one process:
 *  1. Incremental esbuild — `context()` instances (same options as
 *     scripts/build.mjs, shared via scripts/build-config.mjs); a recursive
 *     fs.watch over the source roots calls `rebuild()` on change.
 *  2. Bundle sync — copies the rebuilt plugin bundles into the staged runtime
 *     (.stage/dsh-runtime/node_modules/@oh-dsh/<plugin>/dist/). The DSH host's
 *     client-hmr plugin stat-polls those served bundles (500ms) and broadcasts
 *     `rebuilt` frames over /plugins/events SSE, so the running web UI swaps
 *     the affected plugin fiber in place — no app restart, no page reload.
 *  3. Electron — spawned once; restarted automatically only when the Electron
 *     main-process bundle (dist/main.js / preload.cjs / splash.html) changes.
 *
 * Host-side (node) plugin code and Electron main-process changes need a
 * restart to take effect: client bundles hot-reload, host bundles are synced
 * too and become live after "DSH → 重新启动 DSH Runtime" (CmdOrCtrl+Shift+R)
 * or after this launcher restarts Electron.
 *
 * Usage: node scripts/dev.mjs
 * Requires: dist/ from `pnpm run build` and a staged runtime from
 * `pnpm run stage:dsh` (this launcher only syncs, never stages).
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, watch } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { context } from 'esbuild'
import { desktopBuilds } from './build-config.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const runtime = join(root, '.stage', 'dsh-runtime')
const electronBinary = join(root, 'node_modules', '.bin', 'electron')

const runtimeCli = join(runtime, 'lib', 'bin.js')
if (!existsSync(runtimeCli)) {
  console.error(`[dev] staged DSH runtime is missing (${runtimeCli})`)
  console.error('[dev] run `CI=true pnpm run build:dsh && CI=true pnpm run stage:dsh` once, then retry')
  process.exit(1)
}

/** [dist-relative source, runtime package dist target] pairs, mirroring stage-dsh. */
const SYNC_PAIRS = [
  ['dist/client.js', '@oh-dsh/desktop/dist/client.js'],
  ['dist/client.js.map', '@oh-dsh/desktop/dist/client.js.map'],
  ['dist/plugin.js', '@oh-dsh/desktop/dist/plugin.js'],
  ['dist/cordis.patch.yml', '@oh-dsh/desktop/dist/cordis.patch.yml'],
  ...['better-sidebar-runtime', 'desktop-skins', 'desktop-sidebar', 'panel-controls',
    'pinned-summary', 'plugin-marketplace'].flatMap(directory => [
    [`dist/plugins/${directory}/index.js`, `@oh-dsh/${directory}/dist/index.js`],
    [`dist/plugins/${directory}/client.js`, `@oh-dsh/${directory}/dist/client.js`],
    [`dist/plugins/${directory}/client.js.map`, `@oh-dsh/${directory}/dist/client.js.map`],
  ]),
]

let syncedCount = 0
function syncBundles() {
  syncedCount = 0
  for (const [source, target] of SYNC_PAIRS) {
    const from = join(root, source)
    const to = join(runtime, 'node_modules', target)
    if (!existsSync(from)) continue
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    syncedCount += 1
  }
}

function log(line) {
  process.stdout.write(`[dev] ${line}\n`)
}

// ── 1: incremental esbuild contexts over the shared build options ──────────
const contexts = []
for (const options of desktopBuilds(root)) {
  contexts.push(await context(options))
}

let rebuilding = false
let queued = false
async function rebuildAll(reason) {
  if (rebuilding) {
    queued = true
    return
  }
  rebuilding = true
  try {
    await Promise.all(contexts.map(buildContext => buildContext.rebuild()))
    syncBundles()
    log(`rebuilt (${reason}) + synced ${syncedCount} bundles → .stage/dsh-runtime`)
  } catch (error) {
    log(`build failed (${reason}): ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    rebuilding = false
    if (queued) {
      queued = false
      await rebuildAll('queued change')
    }
  }
}

// ── 2 + 3: initial build, then watch sources; Electron auto-restart ─────────
let rebuildTimer = undefined
const WATCH_ROOTS = [join(root, 'src'), join(root, 'plugins'), join(root, '..', 'DSH-better-sidebar', 'src')]
for (const watchRoot of WATCH_ROOTS) {
  if (!existsSync(watchRoot)) continue
  watch(watchRoot, { recursive: true, persistent: true }, () => {
    clearTimeout(rebuildTimer)
    rebuildTimer = setTimeout(() => void rebuildAll('source change'), 120)
  })
}

await rebuildAll('initial')
log(`initial build done, synced ${syncedCount} bundles to ${join('.stage', 'dsh-runtime')}`)

let electron = undefined
let restartTimer = undefined

function startElectron() {
  if (electron !== undefined) return
  // Optional extra Chromium args, e.g.
  //   OH_DSH_ELECTRON_ARGS='--remote-debugging-port=9222' pnpm run dev
  // for CDP-based inspection (chrome-use / DevTools).
  const extraArgs = (process.env.OH_DSH_ELECTRON_ARGS ?? '').split(' ').filter(Boolean)
  log(`starting electron . (${electronBinary})${extraArgs.length > 0 ? ` args=${extraArgs.join(' ')}` : ''}`)
  electron = spawn(electronBinary, ['.', ...extraArgs], { cwd: root, stdio: 'inherit' })
  electron.on('exit', (code, signal) => {
    log(`electron exited (code=${String(code)} signal=${String(signal)})`)
    electron = undefined
  })
}

function stopElectron() {
  if (electron === undefined) return
  log('restarting electron…')
  const child = electron
  electron = undefined
  child.kill('SIGTERM')
}

const RESTART_TRIGGERS = new Set(['main.js', 'preload.cjs', 'splash.html'])
watch(dist, { persistent: true }, (_event, filename) => {
  if (filename === null || !RESTART_TRIGGERS.has(filename)) return
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    log(`main-process bundle changed: ${filename}`)
    stopElectron()
    setTimeout(startElectron, 250)
  }, 250)
})

startElectron()
log('hot reload ready — edit plugins/*/src/client.* for live UI updates;')
log('host-side and Electron changes restart automatically.')

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopElectron()
    process.exit(0)
  })
}

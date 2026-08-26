/**
 * AppController lifecycle state machine behavior tests
 * (kernel-refactor leaf-2.2, target-design §4.1).
 *
 * Drives src/app-controller.ts through injectable fakes — no Electron —
 * covering the legal transition table (idle → acquiring-lock →
 * bootstrapping → starting-runtime → ready ⇄ restarting, plus the
 * failed-splash sink), the orthogonal preview/updating/quitting substates,
 * and the event adapters: second-instance / activate races against an
 * in-flight restart, runtime exit during quit, install-on-quit failure
 * returning to ready, and deferred workspace-path consumption on ready
 * entry.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AppController,
  type AppControllerPorts,
  type PreviewRuntimeRequest,
  type RuntimeHandle,
  type SplashRequest,
  type WindowHandle,
} from '../src/app-controller.ts'

type ExitEvent = { code: number | null; signal: string | null }

class FakeRuntime implements RuntimeHandle {
  startCalls = 0
  stopCalls = 0
  holdNext = false
  exitOnStop = false
  stopError: Error | undefined
  private readonly exitListeners: Array<(exit: ExitEvent) => void> = []
  private pending: Array<{ reject: (error: Error) => void; resolve: (url: URL) => void }> = []

  start(): Promise<URL> {
    this.startCalls += 1
    if (!this.holdNext) {
      return Promise.resolve(new URL(`http://127.0.0.1:${String(9000 + this.startCalls)}`))
    }
    this.holdNext = false
    return new Promise((resolve, reject) => { this.pending.push({ reject, resolve }) })
  }

  /** Release the oldest held start so it becomes ready. */
  release(): void {
    const gate = this.pending.shift()
    assert.ok(gate !== undefined, 'release() without a held start')
    gate.resolve(new URL('http://127.0.0.1:9100'))
  }

  /** Fail the oldest held start, as a crash before readiness would. */
  failStart(error: Error): void {
    const gate = this.pending.shift()
    assert.ok(gate !== undefined, 'failStart() without a held start')
    gate.reject(error)
  }

  async stop(): Promise<void> {
    this.stopCalls += 1
    if (this.exitOnStop) this.emitExit({ code: 0, signal: null })
    if (this.stopError !== undefined) throw this.stopError
  }

  onExit(listener: (exit: ExitEvent) => void): void {
    this.exitListeners.push(listener)
  }

  emitExit(exit: ExitEvent): void {
    for (const listener of [...this.exitListeners]) listener(exit)
  }
}

class FakeWindow implements WindowHandle {
  loads: string[] = []
  destroyed = false
  shown = 0
  focused = 0
  loadError: Error | undefined
  private readonly closedListeners: Array<() => void> = []

  isDestroyed(): boolean { return this.destroyed }

  async loadURL(url: string): Promise<void> {
    if (this.loadError !== undefined) throw this.loadError
    this.loads.push(url)
  }

  destroy(): void { this.close() }

  close(): void {
    this.destroyed = true
    for (const listener of [...this.closedListeners]) listener()
  }

  show(): void { this.shown += 1 }
  focus(): void { this.focused += 1 }

  onceClosed(listener: () => void): void {
    if (this.destroyed) { listener(); return }
    this.closedListeners.push(listener)
  }
}

interface HarnessOptions {
  shouldInstallUpdateOnQuit?: boolean
  installUpdateOnQuit?: () => Promise<{ status: string } | undefined>
  runPluginInstall?: (pluginPath: string) => Promise<void>
  /**
   * Per-index factories so a test can pre-configure a runtime (e.g. hold its
   * start gate) before the controller spawns it asynchronously.
   */
  liveRuntimeFactory?: (index: number) => FakeRuntime
  previewRuntimeFactory?: (index: number) => FakeRuntime
}

function createHarness(options: HarnessOptions = {}) {
  const live: FakeRuntime[] = []
  const previews: FakeRuntime[] = []
  const windows: FakeWindow[] = []
  const splashes: SplashRequest[] = []
  const sentPaths: string[][] = []
  const logLines: string[] = []
  const installFailureReports: string[] = []
  const counters = { openUpdateWindow: 0, closeUpdateWindow: 0, gatewayClosed: false }
  let mainWindow: FakeWindow | undefined
  let previewSurfaceWindow: FakeWindow | undefined

  const ensureMain = (): FakeWindow => {
    if (mainWindow === undefined || mainWindow.destroyed) {
      mainWindow = new FakeWindow()
      windows.push(mainWindow)
    }
    return mainWindow
  }

  const ports: AppControllerPorts = {
    log: line => { logLines.push(line) },
    recentLogLines: count => logLines.slice(-count),
    resolveWorkspacePaths: paths => {
      const resolved: string[] = []
      for (const candidate of paths) {
        // Mirror normalization: unknown paths are dropped, duplicates merge.
        if (candidate === '/missing') continue
        if (!resolved.includes(candidate)) resolved.push(candidate)
      }
      return resolved
    },
    createLiveRuntime: () => {
      const runtime = options.liveRuntimeFactory?.(live.length) ?? new FakeRuntime()
      live.push(runtime)
      return runtime
    },
    createPreviewRuntime: () => {
      const runtime = options.previewRuntimeFactory?.(previews.length) ?? new FakeRuntime()
      previews.push(runtime)
      return runtime
    },
    ensureMainWindow: ensureMain,
    mainWindow: () => (mainWindow !== undefined && !mainWindow.destroyed ? mainWindow : undefined),
    createPreviewWindow: () => {
      previewSurfaceWindow = new FakeWindow()
      windows.push(previewSurfaceWindow)
      return previewSurfaceWindow
    },
    // The real splash adapter loads the splash into the main window, so the
    // fake must register one too: activate()/second-instance() depend on it.
    showSplash: async request => {
      splashes.push(request ?? {})
      ensureMain()
    },
    sendOpenPaths: paths => { sentPaths.push(paths) },
    shouldInstallUpdateOnQuit: () => options.shouldInstallUpdateOnQuit === true,
    installUpdateOnQuit: options.installUpdateOnQuit ?? (async () => ({ status: 'success' })),
    openUpdateWindow: async () => { counters.openUpdateWindow += 1 },
    closeUpdateWindow: () => { counters.closeUpdateWindow += 1 },
    stopMarketplaceAgentGateway: async () => { counters.gatewayClosed = true },
    runPluginInstall: options.runPluginInstall ?? (async () => {}),
    reportPluginInstallFailure: async detail => { installFailureReports.push(detail) },
  }
  return {
    controller: new AppController(ports),
    live,
    previews,
    windows,
    splashes,
    sentPaths,
    logLines,
    installFailureReports,
    counters,
    mainWindow: () => mainWindow,
    previewWindow: () => previewSurfaceWindow,
  }
}

/** Drive the event loop until the predicate holds, with a bounded budget. */
async function until(predicate: () => boolean, label = 'condition'): Promise<void> {
  for (let i = 0; i < 500 && !predicate(); i += 1) {
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.ok(predicate(), `timed out waiting for ${label}`)
}

function requireWindow(window: FakeWindow | undefined): FakeWindow {
  assert.ok(window !== undefined)
  return window
}

/** Strict-mode helper: fetch an array element that must exist. */
function at<T>(list: T[], index: number): T {
  const value = list[index]
  assert.ok(value !== undefined)
  return value
}

function previewRequest(pluginId = 'demo-plugin'): PreviewRuntimeRequest {
  return { dshHome: '/tmp/dsh-home', pluginId, sandboxRoot: '/tmp/sandbox', transactionId: 'tx-1' }
}

test('boot walks idle → acquiring-lock → bootstrapping → starting-runtime → ready', async () => {
  const h = createHarness()
  assert.equal(h.controller.snapshot().phase, 'idle')
  h.controller.markAcquiringLock()
  assert.equal(h.controller.snapshot().phase, 'acquiring-lock')
  h.controller.markBootstrapping()
  assert.equal(h.controller.snapshot().phase, 'bootstrapping')
  await h.controller.restart()
  assert.equal(h.live.length, 1)
  assert.equal(h.controller.snapshot().phase, 'ready')
  assert.equal(h.controller.runtimeStatus(), 'ready')
})

test('paths buffered before boot are normalized and consumed on ready entry', async () => {
  const h = createHarness()
  h.controller.queuePaths(['/ws/a', '/missing', '/ws/a', '/ws/b'])
  await h.controller.restart()
  // The renderer receives exactly one open-paths command with the
  // normalized (existing, deduplicated) directories.
  assert.deepEqual(h.sentPaths, [['/ws/a', '/ws/b']])
})

test('restart while a restart is in flight is a no-op (single transition)', async () => {
  const held = new FakeRuntime()
  held.holdNext = true
  const h = createHarness({ liveRuntimeFactory: index => (index === 1 ? held : new FakeRuntime()) })
  await h.controller.restart()
  const inFlight = h.controller.restart()
  // Wait until the replacement runtime has actually spawned and its start
  // gate is pending before racing events against it.
  await until(() => h.live.length === 2, 'replacement runtime spawned')
  // The concurrent call must fall through without spawning another runtime.
  await h.controller.restart()
  assert.equal(h.live.length, 2)
  assert.equal(at(h.live, 0).startCalls, 1)
  held.release()
  await inFlight
  assert.equal(h.controller.snapshot().phase, 'ready')
  assert.equal(at(h.live, 0).stopCalls, 1)
})

test('second-instance during a restart defers delivery to the ready entry', async () => {
  const held = new FakeRuntime()
  held.holdNext = true
  const h = createHarness({ liveRuntimeFactory: index => (index === 1 ? held : new FakeRuntime()) })
  await h.controller.restart()
  const inFlight = h.controller.restart()
  await until(() => h.live.length === 2, 'replacement runtime spawned')
  h.controller.secondInstance(['/late-arriving-ws'])
  // Nothing may be pushed into a splash/loading window mid-restart…
  assert.deepEqual(h.sentPaths, [])
  held.release()
  await inFlight
  // …the ready entry action consumes the buffered path instead.
  await until(() => h.sentPaths.length > 0, 'deferred path delivery')
  assert.deepEqual(h.sentPaths, [['/late-arriving-ws']])
})

test('activate during a restart neither spawns nor loads a second window', async () => {
  const held = new FakeRuntime()
  held.holdNext = true
  const h = createHarness({ liveRuntimeFactory: index => (index === 1 ? held : new FakeRuntime()) })
  await h.controller.restart()
  const windowsBeforeActivate = h.windows.length
  const inFlight = h.controller.restart()
  await until(() => h.live.length === 2, 'replacement runtime spawned')
  h.controller.activate()
  assert.equal(h.windows.length, windowsBeforeActivate)
  assert.ok(h.windows.every(window => window.loads.length <= 1))
  held.release()
  await inFlight
  // Once ready, activate re-shows the existing window instead of spawning.
  h.controller.activate()
  const current = requireWindow(h.mainWindow())
  assert.ok(current.shown >= 1)
})

test('second-instance while ready re-shows the window and flushes immediately', async () => {
  const h = createHarness()
  await h.controller.restart()
  h.controller.secondInstance(['/direct-ws'])
  assert.deepEqual(h.sentPaths, [['/direct-ws']])
  const current = requireWindow(h.mainWindow())
  assert.ok(current.shown >= 1)
  assert.ok(current.focused >= 1)
})

test('open-file before ready joins the ready-entry delivery', async () => {
  const h = createHarness()
  h.controller.openFile('/from-finder')
  assert.deepEqual(h.sentPaths, [])
  await h.controller.restart()
  assert.deepEqual(h.sentPaths, [['/from-finder']])
  // Once ready, further open-file events deliver immediately.
  h.controller.openFile('/another')
  assert.deepEqual(h.sentPaths, [['/from-finder'], ['/another']])
})

test('runtime exit while ready sinks to failed-splash and reports stopped', async () => {
  const h = createHarness()
  await h.controller.restart()
  at(h.live, 0).emitExit({ code: 1, signal: null })
  assert.equal(h.controller.snapshot().phase, 'failed-splash')
  assert.equal(h.controller.runtimeStatus(), 'stopped')
  assert.equal(h.controller.snapshot().runtimeUrl, null)
  const errorSplashes = h.splashes.filter(splash => splash.error === true)
  assert.equal(errorSplashes.length, 1)
  const failureSplash = errorSplashes[0]
  assert.ok(failureSplash !== undefined && failureSplash.detail !== undefined)
  assert.ok(failureSplash.detail.length > 0)
})

test('runtime exit while restarting does not splash and the restart completes', async () => {
  const held = new FakeRuntime()
  held.holdNext = true
  const h = createHarness({ liveRuntimeFactory: index => (index === 1 ? held : new FakeRuntime()) })
  await h.controller.restart()
  const inFlight = h.controller.restart()
  await until(() => h.live.length === 2, 'replacement runtime spawned')
  // The old runtime dies exactly while its replacement starts up.
  at(h.live, 0).emitExit({ code: 0, signal: null })
  held.release()
  await inFlight
  assert.equal(h.controller.snapshot().phase, 'ready')
  assert.equal(h.splashes.filter(splash => splash.error === true).length, 0)
})

test('restart start failure sinks to failed-splash with diagnostics', async () => {
  const failing = new FakeRuntime()
  failing.holdNext = true
  const h = createHarness({ liveRuntimeFactory: index => (index === 1 ? failing : new FakeRuntime()) })
  await h.controller.restart()
  const inFlight = h.controller.restart()
  await until(() => h.live.length === 2, 'replacement runtime spawned')
  failing.failStart(new Error('exited before readiness'))
  await inFlight
  assert.equal(h.controller.snapshot().phase, 'failed-splash')
  assert.equal(h.splashes.filter(splash => splash.error === true).length, 1)
})

test('application quit tears down once and a runtime exit mid-shutdown stays quiet', async () => {
  const h = createHarness()
  await h.controller.restart()
  at(h.live, 0).exitOnStop = true
  const quitCalled = new Promise<void>(resolve => {
    h.controller.beforeQuit({
      preventDefault: () => {},
      quit: () => { resolve() },
    })
  })
  await quitCalled
  assert.equal(h.counters.gatewayClosed, true)
  assert.equal(h.counters.closeUpdateWindow, 1)
  assert.equal(at(h.live, 0).stopCalls, 1)
  assert.equal(h.splashes.filter(splash => splash.error === true).length, 0)
  assert.equal(h.controller.snapshot().quitting, true)

  // A second before-quit while the shutdown already ran must not hijack the
  // pending real quit: no additional teardown pass is started.
  let preventedAgain = false
  let quitAgain = false
  h.controller.beforeQuit({
    preventDefault: () => { preventedAgain = true },
    quit: () => { quitAgain = true },
  })
  assert.equal(preventedAgain, false)
  assert.equal(quitAgain, false)
})

test('install-on-quit failure stands the shell back up to ready and reopens the updater', async () => {
  const h = createHarness({
    shouldInstallUpdateOnQuit: true,
    installUpdateOnQuit: async () => ({ status: 'error' }),
  })
  await h.controller.restart()
  let prevented = false
  h.controller.beforeQuit({
    preventDefault: () => { prevented = true },
    quit: () => { assert.fail('quit must not proceed after a failed install') },
  })
  assert.equal(prevented, true)
  assert.equal(h.controller.snapshot().updating, 'installing-on-quit')
  await until(
    () => h.controller.snapshot().phase === 'ready'
      && h.controller.snapshot().updating === 'none'
      && h.controller.snapshot().quitting === false,
    'return to ready after failed install',
  )
  assert.equal(h.counters.openUpdateWindow, 1)
  assert.equal(h.controller.runtimeStatus(), 'ready')
})

test('install-on-quit success completes the shutdown and quits', async () => {
  const h = createHarness({
    shouldInstallUpdateOnQuit: true,
    installUpdateOnQuit: async () => ({ status: 'success' }),
  })
  await h.controller.restart()
  const quitCalled = new Promise<void>(resolve => {
    h.controller.beforeQuit({
      preventDefault: () => {},
      quit: () => { resolve() },
    })
  })
  await quitCalled
  assert.equal(h.counters.gatewayClosed, true)
  assert.equal(h.controller.snapshot().updating, 'installing-on-quit')
  assert.equal(h.controller.snapshot().quitting, true)
})

test('install-on-quit crash surfaces the update-failure splash and stays alive', async () => {
  const h = createHarness({
    shouldInstallUpdateOnQuit: true,
    installUpdateOnQuit: async () => { throw new Error('installer exploded') },
  })
  await h.controller.restart()
  h.controller.beforeQuit({
    preventDefault: () => {},
    quit: () => { assert.fail('quit must not proceed when the installer throws') },
  })
  await until(
    () => h.controller.snapshot().updating === 'none' && h.controller.snapshot().quitting === false,
    'substate reset after installer crash',
  )
  const errorSplashes = h.splashes.filter(splash => splash.error === true)
  assert.equal(errorSplashes.length, 1)
})

test('marketplace profile swap walks ready ⇄ restarting through the controller', async () => {
  const h = createHarness()
  await h.controller.restart()
  await h.controller.stopLiveForMarketplace()
  assert.equal(h.controller.runtimeStatus(), 'restarting')
  await h.controller.startLiveForMarketplace()
  assert.equal(h.controller.snapshot().phase, 'ready')
  assert.equal(h.live.length, 2)
  assert.equal(at(h.live, 0).stopCalls, 1)
  assert.equal(at(h.live, 1).startCalls, 1)
})

test('preview substate walks stopped → starting → active, and exit clears it', async () => {
  const firstPreview = new FakeRuntime()
  firstPreview.holdNext = true
  const h = createHarness({
    previewRuntimeFactory: index => (index === 0 ? firstPreview : new FakeRuntime()),
  })
  await h.controller.restart()
  const starting = h.controller.startPreviewSurface(previewRequest())
  // startPreviewSurface stops any previous surface first (an await), so the
  // starting substate appears on a later tick.
  await until(() => h.controller.snapshot().preview === 'starting', 'preview starting')
  assert.equal(h.controller.snapshot().preview, 'starting')
  firstPreview.release()
  await starting
  assert.equal(h.controller.snapshot().preview, 'active')
  assert.match(requireWindow(h.previewWindow()).loads[0] ?? '', /^http:\/\/127\.0\.0\.1:/)
  assert.deepEqual(h.controller.currentPreviewIdentity(), {
    pluginId: 'demo-plugin',
    transactionId: 'tx-1',
  })

  // Starting a new preview replaces the previous surface atomically.
  await h.controller.startPreviewSurface(previewRequest('second-plugin'))
  assert.equal(h.controller.snapshot().preview, 'active')
  assert.equal(h.previews.length, 2)
  assert.equal(at(h.previews, 0).stopCalls, 1)
  assert.deepEqual(h.controller.currentPreviewIdentity(), {
    pluginId: 'second-plugin',
    transactionId: 'tx-1',
  })

  at(h.previews, 1).emitExit({ code: 0, signal: 'SIGTERM' })
  assert.equal(h.controller.snapshot().preview, 'stopped')
  assert.ok(requireWindow(h.previewWindow()).destroyed)
  assert.equal(h.controller.currentPreviewIdentity(), null)
})

test('closing the preview window stops its runtime and clears the substate', async () => {
  const h = createHarness()
  await h.controller.restart()
  await h.controller.startPreviewSurface(previewRequest())
  const window = requireWindow(h.previewWindow())
  // User-driven close: the sandboxed runtime must be taken down with it.
  window.close()
  assert.equal(h.controller.snapshot().preview, 'stopped')
  assert.equal(at(h.previews, 0).stopCalls, 1)
  assert.equal(h.controller.currentPreviewIdentity(), null)
})

test('preview start failure resets the substate to stopped and rethrows', async () => {
  const failingPreview = new FakeRuntime()
  failingPreview.holdNext = true
  const h = createHarness({
    previewRuntimeFactory: index => (index === 0 ? failingPreview : new FakeRuntime()),
  })
  await h.controller.restart()
  const failing = h.controller.startPreviewSurface(previewRequest())
  await until(() => h.controller.snapshot().preview === 'starting', 'preview starting')
  failingPreview.failStart(new Error('preview never became ready'))
  await assert.rejects(failing, /preview never became ready/)
  assert.equal(h.controller.snapshot().preview, 'stopped')
  assert.equal(h.controller.currentPreviewIdentity(), null)
})

test('installLocalPlugin routes the stop/install/start chain through the machine', async () => {
  const h = createHarness({
    runPluginInstall: async pluginPath => {
      assert.equal(pluginPath, '/plugin-folder')
    },
  })
  await h.controller.restart()
  await h.controller.installLocalPlugin('/plugin-folder')
  assert.equal(h.controller.snapshot().phase, 'ready')
  assert.equal(h.live.length, 2)
  assert.equal(at(h.live, 0).stopCalls, 1)
})

test('installLocalPlugin failure reports to the dialog and lands on failed-splash', async () => {
  const h = createHarness({
    runPluginInstall: async () => { throw new Error('profile add failed') },
  })
  await h.controller.restart()
  await h.controller.installLocalPlugin('/broken-plugin')
  assert.equal(h.controller.snapshot().phase, 'failed-splash')
  assert.deepEqual(h.installFailureReports, ['profile add failed'])
  const errorSplashes = h.splashes.filter(splash => splash.error === true)
  assert.equal(errorSplashes.length, 1)
})

/**
 * AppController — the desktop shell's explicit lifecycle state machine
 * (kernel-refactor leaf-2.2, target-design §4.1).
 *
 * Phases: idle → acquiring-lock → bootstrapping → starting-runtime → ready ⇄
 * restarting, with failed-splash as the failure sink reachable from any
 * phase. Orthogonal substates: preview (stopped|starting|active), updating
 * (none|installing-on-quit), and the quitting intent. Every runtime/preview
 * supervision handle, the deferred workspace-path queue, and the
 * second-instance / activate / before-quit / open-file event semantics live
 * here; src/main.ts keeps no module-level lifecycle booleans or runtime
 * handles.
 *
 * The controller is injectably pure: every side effect (spawning the DSH
 * runtime, creating/loading windows, showing the splash, sending commands to
 * the renderer, installing updates) arrives through AppControllerPorts, so
 * tests/desktop-lifecycle.test.ts drives the machine without Electron.
 */
import { singleFlight } from './update-lifecycle.ts'

/** Sequential lifecycle phases of the desktop shell. */
export type LifecyclePhase =
  | 'idle'
  | 'acquiring-lock'
  | 'bootstrapping'
  | 'starting-runtime'
  | 'ready'
  | 'restarting'
  | 'failed-splash'

/** Orthogonal marketplace-preview substate. */
export type PreviewPhase = 'stopped' | 'starting' | 'active'

/** Orthogonal update-install substate. */
export type UpdatePhase = 'none' | 'installing-on-quit'

export interface RuntimeExitEvent {
  code: number | null
  signal: string | null
}

/** Supervision handle for one DSH runtime process (live or preview). */
export interface RuntimeHandle {
  start(): Promise<URL>
  stop(timeoutMs?: number): Promise<void>
  onExit(listener: (exit: RuntimeExitEvent) => void): void
}

/**
 * Window abstraction the controller drives. `windows.ts` adapts Electron's
 * BrowserWindow onto this shape; the composition root only supplies that
 * adapter through AppControllerPorts.
 */
export interface WindowHandle {
  isDestroyed(): boolean
  loadURL(url: string): Promise<void>
  destroy(): void
  show(): void
  focus(): void
  onceClosed(listener: () => void): void
}

/** Inputs for one sandboxed marketplace preview runtime launch. */
export interface PreviewRuntimeRequest {
  dshHome: string
  pluginId: string
  sandboxRoot: string
  transactionId: string
}

export interface SplashRequest {
  error?: boolean
  message?: string
  detail?: string
}

/**
 * Host capabilities consumed by the controller. `desktop-host.ts` adapts
 * Electron services; tests provide in-memory fakes.
 */
export interface AppControllerPorts {
  /** Append a line to the desktop log (and its tail). */
  log(line: string): void
  /** Last N log lines, newest last, for splash diagnostics. */
  recentLogLines(count: number): string[]
  /** Normalize candidate workspace paths to existing directories. */
  resolveWorkspacePaths(paths: readonly string[]): string[]
  /** Create (but do not start) a new live runtime supervisor. */
  createLiveRuntime(): RuntimeHandle
  /** Create (but do not start) a new sandboxed preview runtime supervisor. */
  createPreviewRuntime(request: PreviewRuntimeRequest): RuntimeHandle
  /** Return the main window, creating it when missing or destroyed. */
  ensureMainWindow(): WindowHandle
  mainWindow(): WindowHandle | undefined
  /** Create and register a new plugin-preview window. */
  createPreviewWindow(pluginId: string): WindowHandle
  showSplash(request?: SplashRequest): Promise<void>
  sendOpenPaths(paths: string[]): void
  shouldInstallUpdateOnQuit(): boolean
  installUpdateOnQuit(): Promise<{ status: string } | undefined>
  openUpdateWindow(): Promise<void>
  closeUpdateWindow(): void
  stopMarketplaceAgentGateway(): Promise<void>
  runPluginInstall(pluginPath: string): Promise<void>
  reportPluginInstallFailure(detail: string): Promise<void>
}

export interface ControllerSnapshot {
  phase: LifecyclePhase
  preview: PreviewPhase
  updating: UpdatePhase
  quitting: boolean
  runtimeUrl: string | null
}

interface PreviewIdentity {
  pluginId: string
  transactionId: string
}

const RESTART_MESSAGE = '正在重新启动 DeepSeek Harness…'
const PROFILE_SWAP_MESSAGE = '正在应用插件 Profile…'
const INSTALL_PLUGIN_MESSAGE = '正在安装 DSH 插件…'
const RUNTIME_DOWN_MESSAGE = 'DeepSeek Harness 已停止。可从“DSH”菜单重新启动。'
const ACTIVATE_DOWN_MESSAGE = 'DeepSeek Harness 未运行，请从“DSH”菜单重新启动。'
const START_FAILED_MESSAGE = 'DSH Studio 启动失败。'
const PLUGIN_INSTALL_FAILED_MESSAGE = '插件安装失败。'
const UPDATE_INSTALL_FAILED_MESSAGE = '更新安装失败。'

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class AppController {
  private readonly ports: AppControllerPorts
  private phase: LifecyclePhase = 'idle'
  private previewPhase: PreviewPhase = 'stopped'
  private updatePhase: UpdatePhase = 'none'
  private quitIntent = false
  private liveHandle: RuntimeHandle | undefined
  private liveUrl: URL | undefined
  private previewSupervisor: RuntimeHandle | undefined
  private previewWindow: WindowHandle | undefined
  private previewUrl: URL | undefined
  private previewTag: PreviewIdentity | undefined
  private pendingPaths: string[] = []
  /**
   * Shared live/preview surface-transition reentry gate (kernel-refactor
   * leaf-2.4): live restarts/install and preview starts enter through this
   * one guard, so no two runtime surface transitions can interleave their
   * stop/start halves regardless of which substate owns them.
   */
  private surfaceTransitionInFlight = false
  private readonly teardownForQuit: () => Promise<void>

  constructor(ports: AppControllerPorts) {
    this.ports = ports
    // Quit-time teardown runs at most once per process, however many times
    // before-quit fires while the asynchronous shutdown is in flight.
    this.teardownForQuit = singleFlight(async () => {
      const results = await Promise.allSettled([
        this.stopLiveRuntime(),
        this.stopPreviewSurface(),
        ports.stopMarketplaceAgentGateway(),
      ])
      for (const result of results) {
        if (result.status === 'rejected') {
          ports.log(describeError(result.reason))
        }
      }
      ports.closeUpdateWindow()
    })
  }

  // ------------------------------------------------------------------
  // Observability
  // ------------------------------------------------------------------

  snapshot(): ControllerSnapshot {
    return {
      phase: this.phase,
      preview: this.previewPhase,
      updating: this.updatePhase,
      quitting: this.quitIntent,
      runtimeUrl: this.liveUrl?.href ?? null,
    }
  }

  /** Coarse runtime status for the renderer's runtime snapshot IPC. */
  runtimeStatus(): 'ready' | 'restarting' | 'stopped' {
    if (this.phase === 'restarting' || this.phase === 'starting-runtime') return 'restarting'
    return this.liveUrl === undefined ? 'stopped' : 'ready'
  }

  runtimeUrl(): URL | undefined {
    return this.liveUrl
  }

  runtimeOrigin(): string | undefined {
    return this.liveUrl?.origin
  }

  previewOrigin(): string | undefined {
    return this.previewUrl?.origin
  }

  currentPreviewIdentity(): PreviewIdentity | null {
    return this.previewTag ?? null
  }

  // ------------------------------------------------------------------
  // Boot phases
  // ------------------------------------------------------------------

  markAcquiringLock(): void {
    this.phase = 'acquiring-lock'
  }

  markBootstrapping(): void {
    this.phase = 'bootstrapping'
  }

  // ------------------------------------------------------------------
  // Deferred workspace paths
  // ------------------------------------------------------------------

  queuePaths(paths: readonly string[]): void {
    this.pendingPaths.push(...paths)
  }

  /** macOS open-with event; delivered immediately only once ready. */
  openFile(path: string): void {
    this.pendingPaths.push(path)
    if (this.phase === 'ready') this.consumeQueuedPaths()
  }

  private consumeQueuedPaths(): void {
    if (this.pendingPaths.length === 0) return
    const paths = this.ports.resolveWorkspacePaths(this.pendingPaths)
    this.pendingPaths = []
    if (paths.length > 0) this.ports.sendOpenPaths(paths)
  }

  // ------------------------------------------------------------------
  // Event adapters (second-instance / activate / open-file / before-quit)
  // ------------------------------------------------------------------

  /**
   * Second launch instance: buffer its workspace paths, then re-enter the
   * ready surface. During restarting/starting the re-entry is deferred —
   * the buffered paths are consumed by the ready entry action instead.
   */
  secondInstance(paths: readonly string[]): void {
    this.queuePaths(paths)
    this.reenterReady()
  }

  /** macOS dock icon activation: ready-state window re-entry. */
  activate(): void {
    const window = this.ports.mainWindow()
    if (window !== undefined && !window.isDestroyed()) {
      window.show()
      return
    }
    const url = this.liveUrl
    if (this.phase === 'ready' && url !== undefined) {
      const created = this.ports.ensureMainWindow()
      void created.loadURL(url.href).then(() => { this.consumeQueuedPaths() })
      return
    }
    void this.ports.showSplash({ error: true, message: ACTIVATE_DOWN_MESSAGE })
  }

  private reenterReady(): void {
    if (this.phase !== 'ready') return
    const window = this.ports.mainWindow()
    if (window !== undefined && !window.isDestroyed()) {
      window.show()
      window.focus()
      this.consumeQueuedPaths()
      return
    }
    const url = this.liveUrl
    if (url === undefined) return
    const created = this.ports.ensureMainWindow()
    void created.loadURL(url.href).then(() => { this.consumeQueuedPaths() })
  }

  /**
   * Application before-quit entry. The first call takes ownership of the
   * quit: it prevents default, tears the runtimes down once, and re-issues
   * the real quit through the adapter. Later calls while the quit is already
   * in flight fall through (no preventDefault) so the pending app.quit()
   * proceeds.
   */
  beforeQuit(adapter: { preventDefault(): void; quit(): void }): void {
    if (this.quitIntent) return
    if (this.ports.shouldInstallUpdateOnQuit()) {
      adapter.preventDefault()
      this.quitIntent = true
      this.updatePhase = 'installing-on-quit'
      this.ports.log('quitting to install desktop update')
      void this.runInstallOnQuit(adapter.quit)
      return
    }
    adapter.preventDefault()
    this.quitIntent = true
    this.ports.log('quitting application')
    void this.teardownForQuit().finally(() => adapter.quit())
  }

  private async runInstallOnQuit(quit: () => void): Promise<void> {
    try {
      await this.teardownForQuit()
      const result = await this.ports.installUpdateOnQuit()
      if (result?.status === 'error') {
        // Install failed: stand the shell back up to ready and reopen the
        // updater so the user can retry.
        this.updatePhase = 'none'
        this.quitIntent = false
        await this.restart()
        await this.ports.openUpdateWindow()
        return
      }
      quit()
    } catch (error) {
      this.updatePhase = 'none'
      this.quitIntent = false
      this.ports.log(`failed to install update on quit: ${describeError(error)}`)
      await this.failToSplash(UPDATE_INSTALL_FAILED_MESSAGE, this.ports.recentLogLines(12).join('\n'))
    }
  }

  // ------------------------------------------------------------------
  // Shared live/preview transition guard
  // ------------------------------------------------------------------

  /** Take the shared surface-transition gate; false when already held. */
  private beginSurfaceTransition(): boolean {
    if (this.surfaceTransitionInFlight) return false
    this.surfaceTransitionInFlight = true
    return true
  }

  private endSurfaceTransition(): void {
    this.surfaceTransitionInFlight = false
  }

  // ------------------------------------------------------------------
  // Live runtime transitions
  // ------------------------------------------------------------------

  /**
   * (Re)start the live runtime: restarting → starting-runtime → ready, whose
   * entry action consumes the deferred workspace paths. Re-entered while a
   * restart is already in flight is a no-op. Failures land on failed-splash.
   */
  async restart(message: string = RESTART_MESSAGE): Promise<void> {
    // A restart owns the shell from splash through ready; re-entry while one
    // is in flight (restarting or starting-runtime) falls through, as does
    // any other live/preview surface transition holding the shared gate.
    if (this.phase === 'restarting' || this.phase === 'starting-runtime') return
    if (!this.beginSurfaceTransition()) return
    this.phase = 'restarting'
    try {
      await this.ports.showSplash({ message })
      await this.stopLiveRuntime()
      await this.beginStartRuntime()
    } catch (error) {
      this.ports.log(error instanceof Error ? error.stack ?? error.message : String(error))
      await this.failToSplash(START_FAILED_MESSAGE, describeError(error))
    } finally {
      this.endSurfaceTransition()
    }
  }

  /** Marketplace profile swap, stop half: ready → restarting. */
  async stopLiveForMarketplace(message: string = PROFILE_SWAP_MESSAGE): Promise<void> {
    this.phase = 'restarting'
    await this.ports.showSplash({ message })
    await this.stopLiveRuntime()
  }

  /** Marketplace profile swap, start half: restarting → ready. Errors propagate. */
  async startLiveForMarketplace(): Promise<void> {
    await this.beginStartRuntime()
  }

  /**
   * Install a local plugin folder into the profile, then bring the runtime
   * back up. The stop goes through the controller-owned reset path rather
   * than mutating handles directly.
   */
  async installLocalPlugin(pluginPath: string): Promise<void> {
    if (this.phase === 'restarting' || this.phase === 'starting-runtime') return
    if (!this.beginSurfaceTransition()) return
    this.phase = 'restarting'
    try {
      await this.ports.showSplash({ message: INSTALL_PLUGIN_MESSAGE })
      await this.stopLiveRuntime()
      await this.ports.runPluginInstall(pluginPath)
      await this.beginStartRuntime()
    } catch (error) {
      const detail = describeError(error)
      this.ports.log(detail)
      await this.failToSplash(PLUGIN_INSTALL_FAILED_MESSAGE, detail)
      await this.ports.reportPluginInstallFailure(detail)
    } finally {
      this.endSurfaceTransition()
    }
  }

  /** starting-runtime entry shared by boot, restart, and marketplace swaps. */
  private async beginStartRuntime(): Promise<void> {
    this.phase = 'starting-runtime'
    const supervisor = this.ports.createLiveRuntime()
    this.liveHandle = supervisor
    supervisor.onExit(exit => { this.handleRuntimeExit(supervisor, exit) })
    const url = await supervisor.start()
    this.liveUrl = url
    this.phase = 'ready'
    const window = this.ports.ensureMainWindow()
    await window.loadURL(url.href)
    this.consumeQueuedPaths()
  }

  private async stopLiveRuntime(): Promise<void> {
    const supervisor = this.liveHandle
    this.clearLive()
    await supervisor?.stop()
  }

  private clearLive(): void {
    this.liveHandle = undefined
    this.liveUrl = undefined
  }

  private handleRuntimeExit(supervisor: RuntimeHandle, exit: RuntimeExitEvent): void {
    this.ports.log(`DSH runtime exited: code=${String(exit.code)} signal=${String(exit.signal)}`)
    if (this.liveHandle !== supervisor) return
    this.clearLive()
    // An exit during an intentional stop/restart or an application quit is
    // expected bookkeeping, not a failure; anything else sinks to the
    // failed-splash so the user can relaunch from the DSH menu.
    if (this.quitIntent || this.phase === 'restarting' || this.phase === 'starting-runtime') return
    void this.failToSplash(RUNTIME_DOWN_MESSAGE, this.ports.recentLogLines(12).join('\n'))
  }

  private async failToSplash(message: string, detail: string): Promise<void> {
    this.phase = 'failed-splash'
    await this.ports.showSplash({ error: true, message, detail })
  }

  // ------------------------------------------------------------------
  // Preview substate
  // ------------------------------------------------------------------

  async startPreviewSurface(request: PreviewRuntimeRequest): Promise<void> {
    // The preview start shares the live transition gate: while a live
    // restart/install or another preview start holds it, a concurrent start
    // would interleave stop/start halves, so it fails loudly instead.
    if (!this.beginSurfaceTransition()) {
      throw new Error('another runtime surface transition is already in flight')
    }
    try {
      await this.startPreviewSurfaceInner(request)
    } finally {
      this.endSurfaceTransition()
    }
  }

  private async startPreviewSurfaceInner(request: PreviewRuntimeRequest): Promise<void> {
    await this.stopPreviewSurface()
    this.previewPhase = 'starting'
    const identity = { pluginId: request.pluginId, transactionId: request.transactionId }
    const supervisor = this.ports.createPreviewRuntime(request)
    this.previewSupervisor = supervisor
    this.previewTag = identity
    supervisor.onExit(exit => { this.handlePreviewExit(supervisor, exit) })
    try {
      const url = await supervisor.start()
      if (this.previewSupervisor !== supervisor) {
        throw new Error('plugin preview was stopped before it became ready')
      }
      this.previewUrl = url
      const window = this.ports.createPreviewWindow(request.pluginId)
      this.previewWindow = window
      window.onceClosed(() => {
        if (this.previewWindow !== window) return
        // The user closed the preview surface: drop its handles and take the
        // sandboxed runtime down with it.
        const supervisor = this.previewSupervisor
        this.clearPreview()
        supervisor?.stop().catch(error => {
          this.ports.log(`failed to stop closed preview runtime: ${describeError(error)}`)
        })
      })
      await window.loadURL(url.href)
      this.previewPhase = 'active'
    } catch (error) {
      await this.stopPreviewSurface().catch(() => {})
      throw error
    }
  }

  async stopPreviewSurface(): Promise<void> {
    const window = this.previewWindow
    const supervisor = this.previewSupervisor
    this.clearPreview()
    if (window !== undefined && !window.isDestroyed()) window.destroy()
    await supervisor?.stop()
  }

  private handlePreviewExit(supervisor: RuntimeHandle, exit: RuntimeExitEvent): void {
    if (this.previewSupervisor !== supervisor) return
    this.ports.log(`preview runtime exited: code=${String(exit.code)} signal=${String(exit.signal)}`)
    const window = this.previewWindow
    if (window !== undefined && !window.isDestroyed()) window.destroy()
    this.clearPreview()
  }

  private clearPreview(): void {
    this.previewSupervisor = undefined
    this.previewWindow = undefined
    this.previewUrl = undefined
    this.previewTag = undefined
    this.previewPhase = 'stopped'
  }
}

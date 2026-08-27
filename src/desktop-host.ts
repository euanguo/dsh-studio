/**
 * Desktop host services — Electron-host facts and adaptations shared by the
 * composition root (kernel-refactor leaf-2.5, target-design §4.2).
 *
 * src/main.ts only composes windows/menu/ipc/runtime-options/AppController
 * onto one another and adapts Electron app events; every host-level fact and
 * behavior those factories consume lives here: the desktop log tail, desktop
 * info/runtime-snapshot views, release-identity assertion, instance identity
 * bootstrap, live/preview supervisor handles, controller ports, the update
 * manager singleton, the marketplace manager + agent gateway, and session
 * permission policy.
 */
import { app, dialog, session, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs'
import type { WriteStream } from 'node:fs'
import { join } from 'node:path'
import { PluginMarketplaceManager } from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'
import {
  startMarketplaceAgentGateway,
  type MarketplaceAgentGateway,
} from '../plugins/plugin-marketplace/src/host/agent-gateway.ts'
import { ProductionMarketplacePlatform } from '../plugins/plugin-marketplace/src/host/platform.ts'
import type {
  DesktopInfo,
  DesktopRuntimeSnapshot,
  DesktopUpdateState,
} from './contracts.ts'
import {
  desktopElectronDataRoot,
  DSH_STUDIO_CHANNEL_ENV,
  DSH_STUDIO_HOME_ENV,
  parseDshStudioChannel,
  resolveDshStudioChannel,
  resolveDshStudioHome,
  resolvePackagedDshStudioChannel,
  takeDshStudioChannelArgs,
  type DshStudioChannel,
} from './data-root.ts'
import { allowsRuntimeClipboardWrite, originOf } from './permissions.ts'
import type {
  AppController,
  AppControllerPorts,
  RuntimeExitEvent,
  RuntimeHandle,
} from './app-controller.ts'
import { BUNDLED_DESKTOP_PLUGINS, DESKTOP_PROFILE, ensureDesktopProfile } from './profile.ts'
import {
  DshRuntimeSupervisor,
  runDshCommand,
  type DshRuntimeOptions,
  type RuntimeExit,
} from './runtime.ts'
import {
  bundledRuntimePaths,
  resolveRuntimeResourcesRoot,
  type BundledRuntimePaths,
} from './runtime-paths.ts'
import { normalizeWorkspacePaths, type IpcModule } from './ipc.ts'
import type { RuntimeOptionsModule } from './runtime-options.ts'
import type { WindowsModule } from './windows.ts'
import {
  resolveUserEnvironment,
  userEnvironmentDiagnostics,
  type UserEnvironmentResolution,
} from './user-environment.ts'
import { DesktopUpdateManager, detectPackageType } from './update-manager.ts'
import {
  appUserModelIdForChannel,
  productNameForChannel,
  releaseIdentityProblem,
} from './desktop-identity.ts'
import { resolveProductVersion } from './version.ts'

/** Composition-time facts fixed by src/main.ts's own location and process. */
export interface DesktopHostInput {
  /** Root above this bundled module; owns package.json and the .stage fallback. */
  repoRoot: string
  resourcesPath: string
  /** Late-bound controller accessor; assigned before any consumer runs. */
  controller(): AppController
  /** Renderer update-state sink; late-bound so composition order stays free. */
  sendUpdateState(state: DesktopUpdateState): void
}

/** Host-level facts and behavior the composition root wires together. */
export interface DesktopHost {
  assertReleaseIdentity(): void
  /** Apply channel/identity facts for this instance; returns launch arguments. */
  applyInstanceIdentity(): string[]
  /** Parse workspace paths out of a second-instance argv. */
  pathsFromSecondInstance(argv: readonly string[]): string[]
  log(stream: 'desktop' | 'stderr' | 'stdout', line: string): void
  recentLogLines(count: number): string[]
  openDesktopLog(): void
  closeLog(): void
  loadUserEnvironment(): Promise<void>
  resolvedUserEnvironment(): UserEnvironmentResolution
  prepareUpdateManager(): Promise<DesktopUpdateManager>
  /** Create the marketplace manager then its agent gateway, in boot order. */
  startMarketplace(runtimeOptions: RuntimeOptionsModule, onStateChange: () => void): Promise<void>
  installSessionPermissions(windows: WindowsModule): void
  desktopInfo(preview?: DesktopInfo['preview']): DesktopInfo
  runtimeSnapshot(): DesktopRuntimeSnapshot
  runtimePaths(): BundledRuntimePaths
  agentGatewayView(): { url: string; token: string } | undefined
  marketplace(): PluginMarketplaceManager | undefined
  controllerPorts(modules: {
    ipc: IpcModule
    runtimeOptions: RuntimeOptionsModule
    windows: WindowsModule
  }): AppControllerPorts
}

/** Wrap a fresh DSH runtime supervisor as a controller RuntimeHandle. */
function supervisorHandle(options: DshRuntimeOptions): RuntimeHandle {
  const supervisor = new DshRuntimeSupervisor(options)
  return {
    onExit: listener => {
      supervisor.on('exit', (exit: RuntimeExit) => {
        listener({ code: exit.code, signal: exit.signal } satisfies RuntimeExitEvent)
      })
    },
    start: () => supervisor.start(),
    stop: timeoutMs => supervisor.stop(timeoutMs),
  }
}

export function createDesktopHost(input: DesktopHostInput): DesktopHost {
  const PRODUCT_VERSION = resolveProductVersion(input.repoRoot)
  let logStream: WriteStream | undefined
  const logTail: string[] = []
  let userEnvironment: UserEnvironmentResolution | undefined
  let marketplace: PluginMarketplaceManager | undefined
  let marketplaceAgentGateway: MarketplaceAgentGateway | undefined
  let updateManagerRef: DesktopUpdateManager | undefined

  function appendLog(stream: 'desktop' | 'stderr' | 'stdout', line: string): void {
    const rendered = `${new Date().toISOString()} [${stream}] ${line}`
    logStream?.write(rendered + '\n')
    logTail.push(rendered)
    if (logTail.length > 200) logTail.splice(0, logTail.length - 200)
  }

  function instanceChannel(): DshStudioChannel {
    return resolveDshStudioChannel(process.env)
  }

  function resourcesRoot(): string {
    return resolveRuntimeResourcesRoot(
      input.resourcesPath,
      join(input.repoRoot, '.stage'),
      app.isPackaged,
    )
  }

  function desktopInfo(preview: DesktopInfo['preview'] = null): DesktopInfo {
    const channel = instanceChannel()
    const appDataPath = resolveDshStudioHome(process.env)
    return {
      appDataPath,
      channel,
      dshHome: appDataPath,
      platform: process.platform,
      preview,
      profile: DESKTOP_PROFILE,
      version: PRODUCT_VERSION,
    }
  }

  function applyDesktopChannelFromArgv(): string[] {
    const raw = process.argv.slice(app.isPackaged ? 1 : 2)
    const taken = takeDshStudioChannelArgs(raw)
    if (taken.channelValue !== undefined) {
      process.env[DSH_STUDIO_CHANNEL_ENV] = parseDshStudioChannel(taken.channelValue)
    }
    return taken.rest
  }

  /**
   * Fail loudly at startup if the release identity drifts from the package's
   * `build` section. The identity facts and the comparison live in
   * desktop-identity.ts; this wrapper only reads the manifest, logs, throws.
   */
  function assertReleaseIdentity(): void {
    let build: Record<string, unknown> | undefined
    try {
      const manifestPath = join(input.repoRoot, 'package.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
      if (typeof manifest.build === 'object' && manifest.build !== null) {
        build = manifest.build as Record<string, unknown>
      }
    } catch {
      // A missing/unreadable manifest cannot be validated; leave build undefined.
    }
    const problem = releaseIdentityProblem(build)
    if (problem !== undefined) {
      appendLog('desktop', problem)
      throw new Error(problem)
    }
  }

  /**
   * Apply the packaged/dev identity for this instance: channel from argv then
   * manifest default, product name/app-id/userData root/about panel. Returns
   * the remaining launch arguments for workspace-path queueing.
   */
  function applyInstanceIdentity(): string[] {
    const launchArguments = applyDesktopChannelFromArgv()
    let packagedDefault: DshStudioChannel | undefined
    if (app.isPackaged) {
      const manifestPath = join(input.repoRoot, 'package.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
      packagedDefault = resolvePackagedDshStudioChannel(manifest)
    }
    const channel = resolveDshStudioChannel(process.env, {
      packaged: app.isPackaged,
      ...(packagedDefault === undefined ? {} : { packagedDefault }),
    })
    process.env[DSH_STUDIO_CHANNEL_ENV] = channel
    const dshStudioHome = resolveDshStudioHome(process.env)
    const electronDataRoot = desktopElectronDataRoot(dshStudioHome)
    const productName = productNameForChannel(channel)
    app.setName(productName)
    if (process.platform === 'win32') {
      app.setAppUserModelId(appUserModelIdForChannel(channel))
    }
    mkdirSync(electronDataRoot, { recursive: true, mode: 0o700 })
    app.setPath('userData', electronDataRoot)
    process.env[DSH_STUDIO_HOME_ENV] = dshStudioHome
    app.setAboutPanelOptions({
      applicationName: productName,
      applicationVersion: PRODUCT_VERSION,
      version: `DeepSeek Harness plugin distribution ${PRODUCT_VERSION}`,
    })
    return launchArguments
  }

  function pathsFromSecondInstance(argv: readonly string[]): string[] {
    const parsed = takeDshStudioChannelArgs(argv.slice(1))
    return parsed.rest.filter(argument => !argument.startsWith('-'))
  }

  function openDesktopLog(): void {
    const info = desktopInfo()
    const logsDir = join(info.appDataPath, 'logs')
    mkdirSync(logsDir, { recursive: true })
    logStream = createWriteStream(join(logsDir, 'desktop.log'), { flags: 'a', mode: 0o600 })
    appendLog(
      'desktop',
      `${productNameForChannel(info.channel)} ${info.version} starting (${process.arch}) channel=${info.channel} home=${info.dshHome}`,
    )
  }

  async function loadUserEnvironment(): Promise<void> {
    const info = desktopInfo()
    userEnvironment = await resolveUserEnvironment({
      base: process.env,
      cachePath: join(info.appDataPath, 'environment-cache.json'),
    })
    for (const line of userEnvironmentDiagnostics(userEnvironment)) appendLog('desktop', line)
  }

  function resolvedUserEnvironment(): UserEnvironmentResolution {
    return userEnvironment ?? {
      env: { ...process.env },
      shell: process.env.SHELL ?? null,
      source: 'process',
    }
  }

  async function prepareUpdateManager(): Promise<DesktopUpdateManager> {
    if (updateManagerRef !== undefined) return updateManagerRef
    async function syncUpdaterProxy(): Promise<void> {
      const updaterSession = session.fromPartition('electron-updater', { cache: false })
      const proxyRules = await session.defaultSession.resolveProxy('https://github.com')
      await updaterSession.setProxy({ proxyRules })
    }
    const packageType = app.isPackaged
      ? await detectPackageType(input.resourcesPath)
      : 'unsupported'
    const manager = new DesktopUpdateManager({
      currentVersion: app.getVersion(),
      appIsPackaged: app.isPackaged,
      packageType,
      ...(app.isPackaged ? { updater: autoUpdater } : {}),
      syncProxy: syncUpdaterProxy,
      onOpenRelease: async url => { await shell.openExternal(url) },
      onOpenInstaller: async path => {
        const error = await shell.openPath(path)
        if (error !== '') throw new Error(error)
      },
      onLog: message => { appendLog('desktop', message) },
    })
    updateManagerRef = manager
    manager.subscribe(input.sendUpdateState)
    return manager
  }

  function createPluginMarketplace(runtimeOptions: RuntimeOptionsModule, onStateChange: () => void): PluginMarketplaceManager {
    const info = desktopInfo()
    ensureDesktopProfile(info.dshHome)
    const paths = bundledRuntimePaths(resourcesRoot())
    const workingDirectory = join(info.appDataPath, 'plugin-marketplace')
    mkdirSync(workingDirectory, { recursive: true, mode: 0o700 })
    // Marketplace installs exec the shared Electron interpreter as pnpm's Node.
    // That is its own exec boundary, so the run-as-node variable is explicit
    // here instead of inherited: the user-scope environment this composes from
    // no longer carries interpreter variables.
    const environment = {
      ...runtimeOptions.runtimeEnvironment(paths, {}, 'marketplace'),
      ELECTRON_RUN_AS_NODE: '1',
    }
    return new PluginMarketplaceManager({
      appDataPath: info.appDataPath,
      dshHome: info.dshHome,
      onStateChange,
      onWarn: line => { appendLog('desktop', `[marketplace] ${line}`) },
      platform: new ProductionMarketplacePlatform({
        cliEntry: paths.cliEntry,
        cwd: workingDirectory,
        env: environment,
        nodeBinary: process.execPath,
        pnpmEntry: paths.pnpmEntry,
        onLog: line => { appendLog('desktop', `[marketplace] ${line}`) },
      }),
      profile: DESKTOP_PROFILE,
      runtime: {
        startLive: () => input.controller().startLiveForMarketplace(),
        startPreview: request => input.controller().startPreviewSurface(request),
        stopLive: () => input.controller().stopLiveForMarketplace(),
        stopPreview: () => input.controller().stopPreviewSurface(),
      },
    })
  }

  async function startMarketplace(
    runtimeOptions: RuntimeOptionsModule,
    onStateChange: () => void,
  ): Promise<void> {
    marketplace = createPluginMarketplace(runtimeOptions, onStateChange)
    marketplaceAgentGateway = await startMarketplaceAgentGateway(marketplace, {
      onError: error => { appendLog('desktop', `[marketplace-agent] ${String(error)}`) },
      onStateChange,
    })
  }

  function installSessionPermissions(windows: WindowsModule): void {
    const controller = input.controller()
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      callback(allowsRuntimeClipboardWrite({
        isMainFrame: details.isMainFrame,
        permission,
        requestingOrigin: details.requestingUrl === undefined
          ? originOf(webContents.getURL())
          : originOf(details.requestingUrl),
        ...(details.requestingUrl === undefined ? {} : { requestingUrl: details.requestingUrl }),
        runtimeOrigin: controller.runtimeOrigin(),
        webContentsIsMainWindow: webContents === windows.mainWindow()?.webContents,
      }))
    })
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      return allowsRuntimeClipboardWrite({
        isMainFrame: details.isMainFrame,
        permission,
        requestingOrigin,
        ...(details.requestingUrl === undefined ? {} : { requestingUrl: details.requestingUrl }),
        runtimeOrigin: controller.runtimeOrigin(),
        webContentsIsMainWindow: webContents === windows.mainWindow()?.webContents,
      })
    })
    const browserSession = session.fromPartition('persist:dsh-studio-browser')
    browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
    browserSession.setPermissionCheckHandler(() => false)
  }

  /**
   * Ports binding the controller to this Electron host. All lifecycle state
   * lives in AppController; these closures only adapt the composed modules.
   */
  function controllerPorts(modules: {
    ipc: IpcModule
    runtimeOptions: RuntimeOptionsModule
    windows: WindowsModule
  }): AppControllerPorts {
    return {
      closeUpdateWindow: () => { modules.windows.closeUpdateWindow() },
      createLiveRuntime: () => {
        ensureDesktopProfile(desktopInfo().dshHome)
        return supervisorHandle(modules.runtimeOptions.runtimeOptions())
      },
      createPreviewRuntime: request =>
        supervisorHandle(modules.runtimeOptions.previewRuntimeOptions(request)),
      createPreviewWindow: pluginId => modules.windows.createPreviewWindowHandle(pluginId),
      ensureMainWindow: () => modules.windows.ensureMainWindowHandle(),
      installUpdateOnQuit: async () =>
        await updateManagerRef?.command({ type: 'install-now' }),
      log: line => { appendLog('desktop', line) },
      mainWindow: () => modules.windows.mainWindowHandle(),
      openUpdateWindow: () => modules.windows.openUpdateWindow(),
      recentLogLines: count => logTail.slice(-count),
      reportPluginInstallFailure: async detail => {
        const options: Electron.MessageBoxOptions = { type: 'error', message: '插件安装失败', detail }
        const parent = modules.windows.mainWindow()
        if (parent === undefined || parent.isDestroyed()) await dialog.showMessageBox(options)
        else await dialog.showMessageBox(parent, options)
      },
      resolveWorkspacePaths: normalizeWorkspacePaths,
      runPluginInstall: async pluginPath => {
        await runDshCommand(
          modules.runtimeOptions.runtimeOptions(),
          ['plugin', '--profile', DESKTOP_PROFILE, 'add', pluginPath],
        )
      },
      sendOpenPaths: paths => { modules.ipc.sendCommand({ type: 'open-paths', paths }) },
      showSplash: async request => { await modules.windows.showSplash(request) },
      shouldInstallUpdateOnQuit: () => updateManagerRef?.shouldInstallOnQuit() === true,
      stopMarketplaceAgentGateway: async () => {
        const gateway = marketplaceAgentGateway
        marketplaceAgentGateway = undefined
        if (gateway !== undefined) await gateway.close()
      },
    }
  }

  return {
    assertReleaseIdentity,
    applyInstanceIdentity,
    pathsFromSecondInstance,
    log: appendLog,
    recentLogLines: count => logTail.slice(-count),
    openDesktopLog,
    closeLog: () => { logStream?.end() },
    loadUserEnvironment,
    resolvedUserEnvironment,
    prepareUpdateManager,
    startMarketplace,
    installSessionPermissions,
    desktopInfo,
    runtimeSnapshot() {
      return {
        bundledPlugins: [...BUNDLED_DESKTOP_PLUGINS],
        logTail: logTail.slice(-100),
        profile: DESKTOP_PROFILE,
        runtimeUrl: input.controller().runtimeUrl()?.href ?? null,
        status: input.controller().runtimeStatus(),
      }
    },
    runtimePaths: () => bundledRuntimePaths(resourcesRoot()),
    agentGatewayView: () =>
      marketplaceAgentGateway === undefined
        ? undefined
        : { token: marketplaceAgentGateway.token, url: marketplaceAgentGateway.url },
    marketplace: () => marketplace,
    controllerPorts,
  }
}

/**
 * Desktop shell entry point — pure composition wiring
 * (kernel-refactor leaf-2.5, target-design §4.2).
 *
 * Composes the shell modules onto one another, adapts Electron app events
 * onto AppController, and preserves the top-level failure path: any bootstrap
 * error surfaces through the failure splash. Host-level facts and behavior
 * (identity, logging, info/snapshot views, update manager, marketplace,
 * session permissions, controller ports) live in desktop-host.ts.
 */
import { app } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppController } from './app-controller.ts'
import { productNameForChannel } from './desktop-identity.ts'
import { resolveDshStudioChannel } from './data-root.ts'
import { createDesktopHost } from './desktop-host.ts'
import { createIpcModule, type IpcModule } from './ipc.ts'
import { createMenuModule } from './menu.ts'
import { createRuntimeOptionsModule } from './runtime-options.ts'
import { createWindowsModule, type WindowsModule } from './windows.ts'

const currentDir = dirname(fileURLToPath(import.meta.url))
// Shell asset locations, derived once from this module's own URL.
const SHELL_ASSETS = {
  preloadPath: join(currentDir, 'preload.cjs'),
  repoRoot: join(currentDir, '..'),
  splashPath: join(currentDir, 'splash.html'),
  updateHtmlPath: join(currentDir, 'update.html'),
  updatePreloadPath: join(currentDir, 'update-preload.cjs'),
} as const

let controller: AppController, ipc: IpcModule, shellWindows: WindowsModule | undefined

const host = createDesktopHost({
  repoRoot: join(currentDir, '..'),
  resourcesPath: process.resourcesPath,
  controller: () => controller,
  sendUpdateState: state => ipc.sendUpdateState(state),
})

/**
 * Failure splash for bootstrap itself, before/without the composed windows
 * module (identity assertion, lock, early Electron failures): no runtime
 * origins to allow and no update manager behind it — only createWindow/
 * showSplash are reachable on this path.
 */
async function showFailureSplash(detail: string): Promise<void> {
  const fallback = shellWindows ?? createWindowsModule({
    channel: () => resolveDshStudioChannel(process.env),
    previewOrigin: () => undefined,
    runtimeOrigin: () => undefined,
    updateManager: async () => { throw new Error('update manager is unavailable during startup failure') },
  }, SHELL_ASSETS)
  await fallback.showSplash({
    detail,
    error: true,
    message: `${productNameForChannel(resolveDshStudioChannel(process.env))} 启动失败。`,
  })
}

async function bootstrap(): Promise<void> {
  host.assertReleaseIdentity()
  const windows = createWindowsModule({
    channel: () => resolveDshStudioChannel(process.env),
    previewOrigin: () => controller.previewOrigin(),
    runtimeOrigin: () => controller.runtimeOrigin(),
    updateManager: () => host.prepareUpdateManager(),
  }, SHELL_ASSETS)
  shellWindows = windows
  const runtimeOptions = createRuntimeOptionsModule({
    desktopInfo: host.desktopInfo,
    log: host.log,
    marketplaceAgentGateway: host.agentGatewayView,
    paths: host.runtimePaths,
    userEnvironment: host.resolvedUserEnvironment,
  })
  ipc = createIpcModule({
    controller: () => controller,
    desktopInfo: host.desktopInfo,
    marketplace: host.marketplace,
    runtimeSnapshot: host.runtimeSnapshot,
    updateManager: host.prepareUpdateManager,
    windows,
  })
  const menu = createMenuModule({
    chooseWorkspace: ipc.chooseWorkspace,
    controller: () => controller,
    desktopInfo: host.desktopInfo,
    installLocalPlugin: ipc.installLocalPlugin,
    openUpdateWindow: windows.openUpdateWindow,
    recentLogLines: host.recentLogLines,
    sendCommand: ipc.sendCommand,
    userEnvironment: host.resolvedUserEnvironment,
  })
  controller = new AppController(host.controllerPorts({ ipc, runtimeOptions, windows }))

  const launchArguments = host.applyInstanceIdentity()
  controller.markAcquiringLock()
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  controller.markBootstrapping()
  // Electron event adapters: the lifecycle decisions live in the controller.
  app.on('second-instance', (_event, argv) => { controller.secondInstance(host.pathsFromSecondInstance(argv)) })
  app.on('open-file', (event, path) => {
    event.preventDefault()
    controller.openFile(path)
  })
  await app.whenReady()
  windows.applyInstanceIcon()

  host.openDesktopLog()
  await host.loadUserEnvironment()
  await host.prepareUpdateManager()
  await host.startMarketplace(runtimeOptions, ipc.broadcastMarketplaceChanged)
  ipc.install()
  host.installSessionPermissions(windows)
  menu.buildMenu()
  await windows.showSplash()
  controller.queuePaths(launchArguments.filter(argument => !argument.startsWith('-')))
  await controller.restart()

  app.on('activate', () => { controller.activate() })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    controller.beforeQuit({
      preventDefault: () => { event.preventDefault() },
      quit: () => {
        host.closeLog()
        app.quit()
      },
    })
  })
}

void bootstrap().catch(async (error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  host.log('desktop', detail)
  if (app.isReady()) await showFailureSplash(detail)
  else {
    await app.whenReady()
    await showFailureSplash(detail)
  }
})

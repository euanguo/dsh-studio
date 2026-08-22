import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  type MenuItemConstructorOptions,
} from 'electron'
import { autoUpdater } from 'electron-updater'
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, type WriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginMarketplaceManager } from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'
import {
  MARKETPLACE_AGENT_TOKEN_ENV,
  MARKETPLACE_AGENT_URL_ENV,
  startMarketplaceAgentGateway,
  type MarketplaceAgentGateway,
} from '../plugins/plugin-marketplace/src/host/agent-gateway.ts'
import {
  findGitHubCli,
  previewSandboxPolicy,
  ProductionMarketplacePlatform,
  withGitHubCredentials,
} from '../plugins/plugin-marketplace/src/host/platform.ts'
import { parseMarketplaceCommand } from '../plugins/plugin-marketplace/src/protocol.ts'
import type {
  DesktopCommand,
  DesktopInfo,
  DesktopRuntimeSnapshot,
  DesktopUpdateCommand,
  DesktopUpdateState,
} from './contracts.ts'
import {
  desktopElectronDataRoot,
  DSH_STUDIO_CHANNEL_ENV,
  DSH_STUDIO_DEV_CHANNEL,
  DSH_STUDIO_HOME_ENV,
  parseDshStudioChannel,
  resolveDshStudioChannel,
  resolvePackagedDshStudioChannel,
  resolveDshStudioHome,
  takeDshStudioChannelArgs,
  type DshStudioChannel,
} from './data-root.ts'
import { allowsRuntimeClipboardWrite, originOf } from './permissions.ts'
import { BUNDLED_DESKTOP_PLUGINS, DESKTOP_PROFILE, ensureDesktopProfile } from './profile.ts'
import {
  DshRuntimeSupervisor,
  runDshCommand,
  type DshRuntimeOptions,
  type RuntimeExit,
  type RuntimeLauncher,
} from './runtime.ts'
import {
  bundledRuntimePaths,
  resolveRuntimeResourcesRoot,
  runtimeSearchPath,
  type BundledRuntimePaths,
} from './runtime-paths.ts'
import { resolveProductVersion } from './version.ts'
import { DesktopUpdateManager, detectPackageType } from './update-manager.ts'
import { scheduleImmediateUpdateInstall, singleFlight } from './update-lifecycle.ts'

const PRODUCT_NAME = 'DSH Studio'
const DESKTOP_APP_USER_MODEL_ID = 'ai.deepseek.dsh-studio'
const DEFAULT_UI_ZOOM_FACTOR = 1.12
const currentDir = dirname(fileURLToPath(import.meta.url))
const PRODUCT_VERSION = resolveProductVersion(join(currentDir, '..'))
const splashPath = join(currentDir, 'splash.html')
const preloadPath = join(currentDir, 'preload.cjs')
const updateHtmlPath = join(currentDir, 'update.html')
const updatePreloadPath = join(currentDir, 'update-preload.cjs')

let mainWindow: BrowserWindow | undefined
let runtime: DshRuntimeSupervisor | undefined
let runtimeUrl: URL | undefined
let runtimeOrigin: string | undefined
let previewRuntime: DshRuntimeSupervisor | undefined
let previewWindow: BrowserWindow | undefined
let previewUrl: URL | undefined
let previewOrigin: string | undefined
let previewIdentity: { pluginId: string; transactionId: string } | undefined
let marketplace: PluginMarketplaceManager | undefined
let marketplaceAgentGateway: MarketplaceAgentGateway | undefined
let logStream: WriteStream | undefined
let updateWindow: BrowserWindow | undefined
let updateManager: DesktopUpdateManager | undefined
let quittingForUpdate = false
let quitting = false
let transitioning = false
let queuedPaths: string[] = []
const logTail: string[] = []

function appendLog(stream: 'desktop' | 'stderr' | 'stdout', line: string): void {
  const rendered = `${new Date().toISOString()} [${stream}] ${line}`
  logStream?.write(rendered + '\n')
  logTail.push(rendered)
  if (logTail.length > 200) logTail.splice(0, logTail.length - 200)
}

function resourcesRoot(): string {
  return resolveRuntimeResourcesRoot(
    process.resourcesPath,
    join(currentDir, '..', '.stage'),
    app.isPackaged,
  )
}

function runtimePaths(): BundledRuntimePaths {
  return bundledRuntimePaths(resourcesRoot())
}

function instanceChannel(): DshStudioChannel {
  return resolveDshStudioChannel(process.env)
}

function instanceProductName(channel: DshStudioChannel = instanceChannel()): string {
  return channel === DSH_STUDIO_DEV_CHANNEL ? `${PRODUCT_NAME}-Dev` : PRODUCT_NAME
}

function instanceWindowTitle(channel: DshStudioChannel = instanceChannel()): string {
  return channel === DSH_STUDIO_DEV_CHANNEL ? `${PRODUCT_NAME} (Dev)` : PRODUCT_NAME
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

function desktopRuntimeSnapshot(): DesktopRuntimeSnapshot {
  return {
    bundledPlugins: [...BUNDLED_DESKTOP_PLUGINS],
    logTail: logTail.slice(-100),
    profile: DESKTOP_PROFILE,
    runtimeUrl: runtimeUrl?.href ?? null,
    status: transitioning ? 'restarting' : runtimeUrl === undefined ? 'stopped' : 'ready',
  }
}

/**
 * The desktop surface shares the Electron-embedded Node as its runtime
 * interpreter: every bundled runtime process (supervisor, marketplace pnpm,
 * sandboxed previews, PATH-discovered launchers) runs as
 * `process.execPath` with ELECTRON_RUN_AS_NODE, so the installed app ships
 * one Node instead of two.
 */
const DESKTOP_NODE_ENV: NodeJS.ProcessEnv = { ELECTRON_RUN_AS_NODE: '1' }

function desktopNodeLauncher(): RuntimeLauncher {
  return { command: process.execPath, env: DESKTOP_NODE_ENV, interpreter: true }
}

function runtimeEnvironment(
  paths: ReturnType<typeof runtimePaths>,
  overrides: { appDataPath?: string; dshHome?: string; preview?: { pluginId: string; transactionId: string } } = {},
): NodeJS.ProcessEnv {
  const info = desktopInfo(overrides.preview ?? null)
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ...DESKTOP_NODE_ENV,
    DSH_STUDIO_DESKTOP: '1',
    DSH_STUDIO_DESKTOP_APP_DATA: overrides.appDataPath ?? info.appDataPath,
    DSH_STUDIO_DESKTOP_PROFILE: info.profile,
    DSH_STUDIO_DESKTOP_VERSION: info.version,
    DSH_HOME: overrides.dshHome ?? info.dshHome,
    DSH_STUDIO_HOME: overrides.dshHome ?? info.dshHome,
    NODE_USE_ENV_PROXY: '1',
    PATH: runtimeSearchPath(paths),
  }
  if (overrides.preview !== undefined) {
    environment.DSH_STUDIO_PREVIEW = '1'
    environment.DSH_STUDIO_PREVIEW_PLUGIN = overrides.preview.pluginId
    environment.DSH_STUDIO_PREVIEW_TRANSACTION = overrides.preview.transactionId
  } else if (marketplaceAgentGateway !== undefined) {
    environment[MARKETPLACE_AGENT_URL_ENV] = marketplaceAgentGateway.url
    environment[MARKETPLACE_AGENT_TOKEN_ENV] = marketplaceAgentGateway.token
  }
  return withGitHubCredentials(environment, findGitHubCli(environment))
}

function runtimeOptions(): DshRuntimeOptions {
  const paths = runtimePaths()
  const workspaceRoot = join(homedir(), 'DSH Workspaces')
  mkdirSync(workspaceRoot, { recursive: true })
  if (!existsSync(paths.nodeBinary)) {
    throw new Error(`packaged Node runtime is missing: ${paths.nodeBinary}`)
  }
  if (!existsSync(paths.cliEntry)) {
    throw new Error(`packaged DSH CLI is missing: ${paths.cliEntry}`)
  }
  return {
    args: ['--profile', DESKTOP_PROFILE],
    cliEntry: paths.cliEntry,
    // The loader/HMR service accesses Node internals; both the standalone
    // binary and the shared Electron interpreter honor this flag.
    nodeFlags: ['--expose-internals'],
    cwd: workspaceRoot,
    env: runtimeEnvironment(paths),
    launcher: desktopNodeLauncher(),
    nodeBinary: paths.nodeBinary,
    onLog: (stream, line) => { appendLog(stream, line) },
    readyTimeoutMs: 60_000,
  }
}

function previewRuntimeOptions(input: {
  dshHome: string
  pluginId: string
  sandboxRoot: string
  transactionId: string
}): DshRuntimeOptions {
  const paths = runtimePaths()
  const workspaceRoot = join(input.sandboxRoot, 'workspace')
  const temporary = join(input.sandboxRoot, '.tmp')
  mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 })
  mkdirSync(temporary, { recursive: true, mode: 0o700 })
  if (!existsSync(paths.nodeBinary)) throw new Error(`packaged Node runtime is missing: ${paths.nodeBinary}`)
  if (!existsSync(paths.cliEntry)) throw new Error(`packaged DSH CLI is missing: ${paths.cliEntry}`)
  const preview = { pluginId: input.pluginId, transactionId: input.transactionId }
  const sandbox = '/usr/bin/sandbox-exec'
  // The sandbox wraps the shared Electron interpreter, not the standalone
  // node binary (which the desktop package no longer carries).
  const launcher: RuntimeLauncher | undefined =
    process.platform === 'darwin' && existsSync(sandbox)
      ? {
          args: ['-p', previewSandboxPolicy(input.sandboxRoot)],
          command: sandbox,
          env: DESKTOP_NODE_ENV,
          interpreter: true,
          interpreterCommand: process.execPath,
        }
      : desktopNodeLauncher()
  return {
    args: ['--profile', DESKTOP_PROFILE],
    cliEntry: paths.cliEntry,
    // The loader/HMR service accesses Node internals; both the standalone
    // binary and the shared Electron interpreter honor this flag.
    nodeFlags: ['--expose-internals'],
    cwd: workspaceRoot,
    env: {
      ...runtimeEnvironment(paths, {
        appDataPath: input.sandboxRoot,
        dshHome: input.dshHome,
        preview,
      }),
      TMPDIR: temporary,
    },
    launcher,
    nodeBinary: paths.nodeBinary,
    onLog: (stream, line) => { appendLog(stream, `[preview:${input.pluginId}] ${line}`) },
    readyTimeoutMs: 90_000,
  }
}

function isAllowedRuntimeNavigation(target: string, allowedOrigin: string | undefined): boolean {
  if (target.startsWith('file:')) return true
  if (allowedOrigin === undefined) return false
  try {
    return new URL(target).origin === allowedOrigin
  } catch {
    return false
  }
}

function isAllowedBrowserNavigation(target: string): boolean {
  if (target === 'about:blank') return true
  try {
    const url = new URL(target)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
    return url.origin !== runtimeOrigin && url.origin !== previewOrigin
  } catch {
    return false
  }
}

function windowIconPath(): string | undefined {
  // Packaged builds carry the official whale logo beside resources/.
  // Source / verification instances use the DEV-stamped sibling so the
  // two apps are distinguishable in the Dock and window switcher.
  if (app.isPackaged) {
    const packaged = join(process.resourcesPath, 'dsh-studio.png')
    if (existsSync(packaged)) return packaged
  }
  if (instanceChannel() === DSH_STUDIO_DEV_CHANNEL) {
    const repoRoot = join(currentDir, '..')
    for (const relative of ['assets/icons-dev/1024x1024.png', 'assets/icons-dev/512x512.png']) {
      const candidate = join(repoRoot, relative)
      if (existsSync(candidate)) return candidate
    }
  }
  const development = join(currentDir, '..', 'assets', 'icons', '512x512.png')
  return existsSync(development) ? development : undefined
}

function applyInstanceIcon(): void {
  const icon = windowIconPath()
  if (icon === undefined || process.platform !== 'darwin') return
  app.dock?.setIcon(icon)
}

function createWindow(options: { preview?: boolean; title?: string } = {}): BrowserWindow {
  const platform = process.platform
  const icon = windowIconPath()
  const window = new BrowserWindow({
    width: options.preview === true ? 1160 : 1280,
    height: options.preview === true ? 760 : 840,
    minWidth: 600,
    minHeight: 620,
    show: false,
    title: options.title ?? instanceWindowTitle(),

    // Platform chrome (mirrors the reference desktop distribution):
    // macOS keeps the inset traffic lights and sidebar vibrancy; Windows
    // uses an overlay caption row over a transparent acrylic body; other
    // platforms run frameless-transparent so the renderer owns the chrome.
    titleBarStyle: platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(platform === 'darwin'
      ? {
        // Vertically center the traffic lights on the 42px unified top
        // rail: the cluster is 14px tall, so y = (42 - 14) / 2 = 14.
        trafficLightPosition: { x: 16, y: 14 },
        vibrancy: 'sidebar' as const,
        visualEffectState: 'followWindow' as const,
      }
      : {}),
    ...(platform === 'win32'
      ? {
        titleBarOverlay: {
          color: '#00000000',
          symbolColor: '#7f858f',
          height: 44,
        },
        backgroundMaterial: 'acrylic' as const,
        hasShadow: true,
        roundedCorners: true,
        thickFrame: true,
      }
      : {}),
    ...(platform === 'darwin' || platform === 'win32'
      ? {}
      : { transparent: true }),
    ...(icon === undefined ? {} : { icon }),
    backgroundColor: '#3478F0',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      webviewTag: true,
    },
  })
  window.webContents.setZoomFactor(DEFAULT_UI_ZOOM_FACTOR)
  window.once('ready-to-show', () => { window.show() })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
    if (previewWindow === window) {
      previewWindow = undefined
      previewUrl = undefined
      previewOrigin = undefined
      previewIdentity = undefined
      const supervisor = previewRuntime
      previewRuntime = undefined
      void supervisor?.stop().catch((error: unknown) => {
        appendLog('desktop', `failed to stop closed preview runtime: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isAllowedBrowserNavigation(params.src ?? 'about:blank')) {
      event.preventDefault()
      return
    }
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
  })
  window.webContents.on('did-attach-webview', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https:') || url.startsWith('http:')) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      if (isAllowedBrowserNavigation(url)) return
      event.preventDefault()
    })
    attachEditingContextMenu(contents)
  })
  window.webContents.on('will-navigate', (event, url) => {
    const allowedOrigin = options.preview === true ? previewOrigin : runtimeOrigin
    if (isAllowedRuntimeNavigation(url, allowedOrigin)) return
    event.preventDefault()
    if (url.startsWith('https:') || url.startsWith('http:')) void shell.openExternal(url)
  })
  attachEditingContextMenu(window.webContents)
  return window
}

async function showSplash(options: { detail?: string; error?: boolean; message?: string } = {}): Promise<void> {
  if (mainWindow === undefined || mainWindow.isDestroyed()) mainWindow = createWindow()
  const query: Record<string, string> = {}
  if (options.error === true) query.state = 'error'
  if (options.message !== undefined) query.message = options.message
  if (options.detail !== undefined) query.detail = options.detail.slice(0, 4_000)
  await mainWindow.loadFile(splashPath, { query })
}

function sendCommand(command: DesktopCommand): void {
  if (mainWindow === undefined || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('desktop:command', command)
}

function sendUpdateState(state: DesktopUpdateState): void {
  if (updateWindow === undefined || updateWindow.isDestroyed()) return
  updateWindow.webContents.send('desktop:update:state', state)
}

async function syncUpdaterProxy(): Promise<void> {
  const updaterSession = session.fromPartition('electron-updater', { cache: false })
  const proxyRules = await session.defaultSession.resolveProxy('https://github.com')
  await updaterSession.setProxy({ proxyRules })
}

async function getUpdateManager(): Promise<DesktopUpdateManager> {
  if (updateManager !== undefined) return updateManager
  const packageType = app.isPackaged
    ? await detectPackageType(process.resourcesPath)
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
  updateManager = manager
  manager.subscribe(sendUpdateState)
  return manager
}

function assertUpdateWindowSender(event: { sender: Electron.WebContents }): void {
  if (updateWindow === undefined || updateWindow.isDestroyed() || event.sender !== updateWindow.webContents) {
    throw new Error('update IPC is only available to the local update window')
  }
}

function parseUpdateCommand(raw: unknown): DesktopUpdateCommand {
  if (typeof raw !== 'object' || raw === null || !('type' in raw) || typeof raw.type !== 'string') {
    throw new Error('invalid update command')
  }
  const type = raw.type
  if (!['check', 'download', 'cancel', 'retry', 'install-now', 'install-on-quit', 'open-release'].includes(type)) {
    throw new Error(`unsupported update command: ${type}`)
  }
  return { type } as DesktopUpdateCommand
}

async function openUpdateWindow(): Promise<void> {
  const manager = await getUpdateManager()
  if (updateWindow !== undefined && !updateWindow.isDestroyed()) {
    updateWindow.show()
    updateWindow.focus()
    void manager.check()
    return
  }
  const window = new BrowserWindow({
    width: 720,
    height: 620,
    minWidth: 560,
    minHeight: 480,
    ...(mainWindow !== undefined && !mainWindow.isDestroyed() ? { parent: mainWindow } : {}),
    modal: false,
    show: false,
    title: 'Software updates',
    webPreferences: {
      preload: updatePreloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  updateWindow = window
  window.setMenuBarVisibility(false)
  window.once('ready-to-show', () => { window.show() })
  window.on('closed', () => {
    if (updateWindow === window) updateWindow = undefined
  })
  window.webContents.on('will-navigate', event => { event.preventDefault() })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  await window.loadFile(updateHtmlPath)
  void manager.check()
}

const stopForApplicationQuit = singleFlight(async (): Promise<void> => {
  await Promise.allSettled([
    runtime?.stop() ?? Promise.resolve(),
    stopPreviewSurface(),
    marketplaceAgentGateway?.close() ?? Promise.resolve(),
  ]).then(results => {
    for (const result of results) {
      if (result.status === 'rejected') {
        appendLog('desktop', result.reason instanceof Error ? result.reason.message : String(result.reason))
      }
    }
  })
  runtime = undefined
  runtimeUrl = undefined
  runtimeOrigin = undefined
  marketplaceAgentGateway = undefined
  if (updateWindow !== undefined && !updateWindow.isDestroyed()) updateWindow.close()
})

function normalizeWorkspacePaths(paths: readonly string[]): string[] {
  const normalized: string[] = []
  for (const candidate of paths) {
    if (!existsSync(candidate)) continue
    const absolute = resolve(candidate)
    const target = statSync(absolute).isDirectory() ? absolute : dirname(absolute)
    if (!normalized.includes(target)) normalized.push(target)
  }
  return normalized
}

function flushQueuedPaths(): void {
  const paths = normalizeWorkspacePaths(queuedPaths)
  queuedPaths = []
  if (paths.length > 0) sendCommand({ type: 'open-paths', paths })
}

function handleRuntimeExit(exit: RuntimeExit): void {
  appendLog('desktop', `DSH runtime exited: code=${String(exit.code)} signal=${String(exit.signal)}`)
  runtimeUrl = undefined
  runtimeOrigin = undefined
  if (quitting || transitioning) return
  void showSplash({
    error: true,
    message: 'DeepSeek Harness 已停止。可从“DSH”菜单重新启动。',
    detail: logTail.slice(-12).join('\n'),
  })
}

async function startRuntime(): Promise<void> {
  const info = desktopInfo()
  ensureDesktopProfile(info.dshHome)
  const supervisor = new DshRuntimeSupervisor(runtimeOptions())
  runtime = supervisor
  supervisor.on('exit', handleRuntimeExit)
  const url = await supervisor.start()
  runtimeUrl = url
  runtimeOrigin = url.origin
  if (mainWindow === undefined || mainWindow.isDestroyed()) mainWindow = createWindow()
  await mainWindow.loadURL(url.href)
  flushQueuedPaths()
}

async function stopPreviewSurface(): Promise<void> {
  const window = previewWindow
  const supervisor = previewRuntime
  previewWindow = undefined
  previewRuntime = undefined
  previewUrl = undefined
  previewOrigin = undefined
  previewIdentity = undefined
  if (window !== undefined && !window.isDestroyed()) window.destroy()
  await supervisor?.stop()
}

async function startPreviewSurface(input: {
  dshHome: string
  pluginId: string
  sandboxRoot: string
  transactionId: string
}): Promise<void> {
  await stopPreviewSurface()
  const identity = { pluginId: input.pluginId, transactionId: input.transactionId }
  const supervisor = new DshRuntimeSupervisor(previewRuntimeOptions(input))
  previewRuntime = supervisor
  previewIdentity = identity
  supervisor.on('exit', (exit: RuntimeExit) => {
    if (previewRuntime !== supervisor) return
    appendLog('desktop', `preview runtime exited: code=${String(exit.code)} signal=${String(exit.signal)}`)
    const window = previewWindow
    previewRuntime = undefined
    previewWindow = undefined
    previewUrl = undefined
    previewOrigin = undefined
    previewIdentity = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
  })
  try {
    const url = await supervisor.start()
    if (previewRuntime !== supervisor) throw new Error('plugin preview was stopped before it became ready')
    previewUrl = url
    previewOrigin = url.origin
    const window = createWindow({
      preview: true,
      title: `Preview ${input.pluginId} — ${instanceWindowTitle()}`,
    })
    previewWindow = window
    await window.loadURL(url.href)
  } catch (error) {
    await stopPreviewSurface().catch(() => {})
    throw error
  }
}

async function stopLiveForMarketplace(): Promise<void> {
  transitioning = true
  await showSplash({ message: '正在应用插件 Profile…' })
  await runtime?.stop()
  runtime = undefined
  runtimeUrl = undefined
  runtimeOrigin = undefined
}

async function startLiveForMarketplace(): Promise<void> {
  try {
    await startRuntime()
  } finally {
    transitioning = false
  }
}

async function restartRuntime(message = '正在重新启动 DeepSeek Harness…'): Promise<void> {
  if (transitioning) return
  transitioning = true
  try {
    await showSplash({ message })
    await runtime?.stop()
    runtime = undefined
    runtimeUrl = undefined
    runtimeOrigin = undefined
    await startRuntime()
  } catch (error) {
    appendLog('desktop', error instanceof Error ? error.stack ?? error.message : String(error))
    await showSplash({
      error: true,
      message: 'DSH Studio 启动失败。',
      detail: error instanceof Error ? error.message : String(error),
    })
  } finally {
    transitioning = false
  }
}

async function selectWorkspacePaths(): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    title: '打开 DSH 工作区',
    properties: ['openDirectory', 'createDirectory'],
  }
  const parent = mainWindow
  const result = parent === undefined || parent.isDestroyed()
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(parent, options)
  return result.canceled ? [] : normalizeWorkspacePaths(result.filePaths)
}

async function chooseWorkspace(): Promise<void> {
  const paths = await selectWorkspacePaths()
  if (paths.length > 0) sendCommand({ type: 'open-paths', paths })
}

async function installLocalPlugin(): Promise<void> {
  const options: Electron.OpenDialogOptions = {
    title: '选择 DSH 插件目录',
    buttonLabel: '安装插件',
    properties: ['openDirectory'],
  }
  const parent = mainWindow
  const choice = parent === undefined || parent.isDestroyed()
    ? await dialog.showOpenDialog(options)
    : await dialog.showOpenDialog(parent, options)
  const pluginPath = choice.filePaths[0]
  if (choice.canceled || pluginPath === undefined) return
  transitioning = true
  try {
    await showSplash({ message: '正在安装 DSH 插件…' })
    await runtime?.stop()
    runtime = undefined
    const options = runtimeOptions()
    await runDshCommand(options, ['plugin', '--profile', DESKTOP_PROFILE, 'add', pluginPath])
    await startRuntime()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    appendLog('desktop', detail)
    await showSplash({ error: true, message: '插件安装失败。', detail })
    const errorOptions: Electron.MessageBoxOptions = { type: 'error', message: '插件安装失败', detail }
    const errorParent = mainWindow
    if (errorParent === undefined || errorParent.isDestroyed()) await dialog.showMessageBox(errorOptions)
    else await dialog.showMessageBox(errorParent, errorOptions)
  } finally {
    transitioning = false
  }
}

function createPluginMarketplace(): PluginMarketplaceManager {
  const info = desktopInfo()
  ensureDesktopProfile(info.dshHome)
  const paths = runtimePaths()
  const workingDirectory = join(info.appDataPath, 'plugin-marketplace')
  mkdirSync(workingDirectory, { recursive: true, mode: 0o700 })
  const environment = runtimeEnvironment(paths)
  return new PluginMarketplaceManager({
    appDataPath: info.appDataPath,
    dshHome: info.dshHome,
    onWarn: line => { appendLog('desktop', `[marketplace] ${line}`) },
    platform: new ProductionMarketplacePlatform({
      cliEntry: paths.cliEntry,
      cwd: workingDirectory,
      env: environment,
      // The shared Electron interpreter runs pnpm; ELECTRON_RUN_AS_NODE is
      // already present in `environment`.
      nodeBinary: process.execPath,
      pnpmEntry: paths.pnpmEntry,
      onLog: line => { appendLog('desktop', `[marketplace] ${line}`) },
    }),
    profile: DESKTOP_PROFILE,
    runtime: {
      startLive: startLiveForMarketplace,
      startPreview: startPreviewSurface,
      stopLive: stopLiveForMarketplace,
      stopPreview: stopPreviewSurface,
    },
  })
}

function labels() {
  const zh = app.getLocale().toLowerCase().startsWith('zh')
  return zh ? {
    checkUpdates: '检查更新…',
    dsh: 'DSH',
    focus: '聚焦输入框',
    installPlugin: '从文件夹安装插件…',
    newChat: '新建会话',
    openData: '打开 DSH 数据目录',
    openLogs: '打开日志目录',
    openPluginProfile: '打开插件配置目录',
    openWorkspace: '打开工作区…',
    restart: '重新启动 DSH Runtime',
    settings: '设置…',
    toggleBottomPanel: '切换底部面板',
    togglePanelMaximized: '展开或还原工具侧栏',
    togglePinnedSummary: '切换置顶摘要',
    toggleSidePanel: '切换工具侧栏',
    toggleWorkspacePanel: '切换工作区面板',
    toggleSidebar: '切换侧栏',
    browser: '浏览器',
    files: '文件',
    review: '审查',
    sideChat: '侧边会话',
    trajectory: '轨迹',
  } : {
    checkUpdates: 'Check for Updates...',
    dsh: 'DSH',
    focus: 'Focus Composer',
    installPlugin: 'Install Plugin from Folder…',
    newChat: 'New Chat',
    openData: 'Open DSH Data Folder',
    openLogs: 'Open Logs Folder',
    openPluginProfile: 'Open Plugin Profile Folder',
    openWorkspace: 'Open Workspace…',
    restart: 'Restart DSH Runtime',
    settings: 'Settings…',
    toggleBottomPanel: 'Toggle Bottom Panel',
    togglePanelMaximized: 'Expand or Restore Side Panel',
    togglePinnedSummary: 'Toggle Pinned Summary',
    toggleSidePanel: 'Toggle Side Panel',
    toggleWorkspacePanel: 'Toggle Workspace Panel',
    toggleSidebar: 'Toggle Sidebar',
    browser: 'Browser',
    files: 'Files',
    review: 'Review',
    sideChat: 'Side Chat',
    trajectory: 'Trajectory',
  }
}

function buildMenu(): void {
  const text = labels()
  const info = desktopInfo()
  const profile = ensureDesktopProfile(info.dshHome)
  const template: MenuItemConstructorOptions[] = [
    {
      label: instanceProductName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: text.checkUpdates, click: () => { void openUpdateWindow() } },
        { type: 'separator' },
        { label: text.settings, accelerator: 'CmdOrCtrl+,', click: () => { sendCommand({ type: 'show-settings' }) } },
        ...(process.platform === 'darwin'
          ? [
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
          ]
          : []),
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: text.newChat, accelerator: 'CmdOrCtrl+N', click: () => { sendCommand({ type: 'new-session' }) } },
        { label: text.openWorkspace, accelerator: 'CmdOrCtrl+O', click: () => { void chooseWorkspace() } },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: text.toggleSidebar, accelerator: 'CmdOrCtrl+B', click: () => { sendCommand({ type: 'toggle-sidebar' }) } },
        { label: text.togglePanelMaximized, click: () => { sendCommand({ type: 'toggle-panel-maximized' }) } },
        { label: text.toggleBottomPanel, accelerator: 'CmdOrCtrl+J', click: () => { sendCommand({ type: 'toggle-bottom-panel' }) } },
        { label: text.togglePinnedSummary, click: () => { sendCommand({ type: 'toggle-pinned-summary' }) } },
        { label: text.toggleSidePanel, accelerator: 'Alt+CmdOrCtrl+B', click: () => { sendCommand({ type: 'toggle-side-panel' }) } },
        { type: 'separator' },
        { label: text.review, accelerator: 'Ctrl+Shift+G', click: () => { sendCommand({ type: 'open-review' }) } },
        { label: text.browser, accelerator: 'CmdOrCtrl+T', click: () => { sendCommand({ type: 'open-browser' }) } },
        { label: text.files, accelerator: 'CmdOrCtrl+P', click: () => { sendCommand({ type: 'open-files' }) } },
        { label: text.sideChat, accelerator: 'Alt+CmdOrCtrl+S', click: () => { sendCommand({ type: 'open-side-chat' }) } },
        { label: text.trajectory, click: () => { sendCommand({ type: 'open-trajectory' }) } },
        { label: text.toggleWorkspacePanel, click: () => { sendCommand({ type: 'toggle-workspace-panel' }) } },
        { type: 'separator' },
        { label: text.focus, accelerator: 'CmdOrCtrl+L', click: () => { sendCommand({ type: 'focus-composer' }) } },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: text.dsh,
      submenu: [
        { label: text.restart, accelerator: 'CmdOrCtrl+Shift+R', click: () => { void restartRuntime() } },
        { type: 'separator' },
        { label: text.installPlugin, click: () => { void installLocalPlugin() } },
        { label: text.openPluginProfile, click: () => { void shell.openPath(profile.profileDir) } },
        { type: 'separator' },
        { label: text.openData, click: () => { void shell.openPath(info.dshHome) } },
        { label: text.openLogs, click: () => { void shell.openPath(join(info.appDataPath, 'logs')) } },
        { type: 'separator' },
        {
          label: 'Copy Diagnostics',
          click: () => {
            clipboard.writeText([
              `${instanceProductName(info.channel)} ${info.version}`,
              `channel=${info.channel}`,
              `home=${info.dshHome}`,
              `platform=${process.platform} ${process.arch}`,
              `profile=${info.profile}`,
              `runtime=${runtimeUrl?.href ?? 'stopped'}`,
              '',
              ...logTail.slice(-80),
            ].join('\n'))
          },
        },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * Attach the native editing context menu (cut/copy/paste/selectAll/undo/redo)
 * to a webContents. Without this, right-click in input fields and text areas
 * shows nothing on macOS/Windows/Linux — the user has no way to copy or paste
 * except via keyboard shortcuts, which many users expect from the right-click.
 */
function attachEditingContextMenu(contents: Electron.WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const template: MenuItemConstructorOptions[] = []
    if (params.isEditable) {
      template.push(
        { role: 'undo', accelerator: 'CmdOrCtrl+Z' },
        { role: 'redo', accelerator: 'CmdOrCtrl+Shift+Z' },
        { type: 'separator' },
        { role: 'cut', accelerator: 'CmdOrCtrl+X' },
        { role: 'copy', accelerator: 'CmdOrCtrl+C' },
        { role: 'paste', accelerator: 'CmdOrCtrl+V' },
        { type: 'separator' },
        { role: 'selectAll', accelerator: 'CmdOrCtrl+A' },
      )
    } else if (params.selectionText !== undefined && params.selectionText !== '') {
      template.push(
        { role: 'copy', accelerator: 'CmdOrCtrl+C' },
        { type: 'separator' },
        { role: 'selectAll', accelerator: 'CmdOrCtrl+A' },
      )
    }
    if (template.length === 0) return
    const menu = Menu.buildFromTemplate(template)
    const win = BrowserWindow.fromWebContents(contents) ?? undefined
    if (win !== undefined) menu.popup({ window: win })
    else menu.popup({})
  })
}

function installIpc(): void {
  ipcMain.handle('desktop:choose-workspace', async () => await selectWorkspacePaths())
  ipcMain.handle('desktop:chrome-geometry', () => {
    // The unified top rail's left reservation: the traffic-light anchor
    // (trafficLightPosition) plus the exact macOS cluster width — three
    // 12px buttons with 8px gaps (Apple HIG) = 52px. The renderer adds
    // its breathing gap and turns this into `--dsh-studio-traffic-left`.
    const platform = process.platform
    return {
      platform,
      trafficLight: platform === 'darwin' ? { x: 16, y: 14 } : null,
      trafficLightWidth: 52,
      trafficLightHeight: 12,
    }
  })
  ipcMain.handle('desktop:update:get-state', async event => {
    assertUpdateWindowSender(event)
    return (await getUpdateManager()).getState()
  })
  ipcMain.handle('desktop:update:command', async (event, raw: unknown) => {
    assertUpdateWindowSender(event)
    const command = parseUpdateCommand(raw)
    const manager = await getUpdateManager()
    const current = manager.getState()
    const installNow = command.type === 'install-now'
      && current.status === 'downloaded'
      && current.platform !== 'deb'
    if (installNow) {
      return await scheduleImmediateUpdateInstall(manager, () => {
        quittingForUpdate = true
        app.quit()
      })
    }
    return await manager.command(command)
  })
  ipcMain.handle('desktop:get-info', event => {
    const preview = previewWindow?.webContents.id === event.sender.id ? previewIdentity ?? null : null
    return desktopInfo(preview)
  })
  ipcMain.handle('desktop:get-runtime-snapshot', () => desktopRuntimeSnapshot())
  ipcMain.handle('desktop:plugin-marketplace-snapshot', () => {
    if (marketplace === undefined) throw new Error('plugin marketplace is not initialized')
    return marketplace.getSnapshot()
  })
  ipcMain.handle('desktop:plugin-marketplace-dispatch', async (_event, raw: unknown) => {
    if (marketplace === undefined) throw new Error('plugin marketplace is not initialized')
    return await marketplace.dispatch(parseMarketplaceCommand(raw))
  })
  ipcMain.handle('desktop:open-external', async (_event, raw: unknown) => {
    if (typeof raw !== 'string') throw new Error('external URL must be a string')
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`unsupported external URL protocol: ${url.protocol}`)
    }
    await shell.openExternal(url.href)
  })
}

function applyDesktopChannelFromArgv(): string[] {
  const raw = process.argv.slice(app.isPackaged ? 1 : 2)
  const taken = takeDshStudioChannelArgs(raw)
  if (taken.channelValue !== undefined) {
    process.env[DSH_STUDIO_CHANNEL_ENV] = parseDshStudioChannel(taken.channelValue)
  }
  return taken.rest
}

function packagedDefaultChannel(): DshStudioChannel | undefined {
  if (!app.isPackaged) return undefined
  const manifestPath = join(currentDir, '..', 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
  return resolvePackagedDshStudioChannel(manifest)
}

async function bootstrap(): Promise<void> {
  const launchArguments = applyDesktopChannelFromArgv()
  const packagedDefault = packagedDefaultChannel()
  const channel = resolveDshStudioChannel(process.env, {
    packaged: app.isPackaged,
    ...(packagedDefault === undefined ? {} : { packagedDefault }),
  })
  process.env[DSH_STUDIO_CHANNEL_ENV] = channel
  const dshStudioHome = resolveDshStudioHome(process.env)
  const electronDataRoot = desktopElectronDataRoot(dshStudioHome)
  const productName = instanceProductName(channel)
  app.setName(productName)
  if (process.platform === 'win32') {
    app.setAppUserModelId(
      channel === DSH_STUDIO_DEV_CHANNEL
        ? `${DESKTOP_APP_USER_MODEL_ID}.dev`
        : DESKTOP_APP_USER_MODEL_ID,
    )
  }
  mkdirSync(electronDataRoot, { recursive: true, mode: 0o700 })
  app.setPath('userData', electronDataRoot)
  process.env[DSH_STUDIO_HOME_ENV] = dshStudioHome
  app.setAboutPanelOptions({
    applicationName: productName,
    applicationVersion: PRODUCT_VERSION,
    version: `DeepSeek Harness plugin distribution ${PRODUCT_VERSION}`,
  })
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }
  app.on('second-instance', (_event, argv) => {
    const launchArguments = takeDshStudioChannelArgs(argv.slice(1))
    queuedPaths.push(...launchArguments.rest.filter(argument => !argument.startsWith('-')))
    if (mainWindow === undefined || mainWindow.isDestroyed()) {
      mainWindow = createWindow()
      if (runtimeUrl !== undefined) void mainWindow.loadURL(runtimeUrl.href).then(flushQueuedPaths)
    } else {
      mainWindow.show()
      mainWindow.focus()
      flushQueuedPaths()
    }
  })
  app.on('open-file', (event, path) => {
    event.preventDefault()
    queuedPaths.push(path)
    if (app.isReady()) flushQueuedPaths()
  })
  await app.whenReady()
  applyInstanceIcon()

  const info = desktopInfo()
  const logsDir = join(info.appDataPath, 'logs')
  mkdirSync(logsDir, { recursive: true })
  logStream = createWriteStream(join(logsDir, 'desktop.log'), { flags: 'a', mode: 0o600 })
  appendLog(
    'desktop',
    `${instanceProductName(info.channel)} ${info.version} starting (${process.arch}) channel=${info.channel} home=${info.dshHome}`,
  )
  await getUpdateManager()
  marketplace = createPluginMarketplace()
  marketplaceAgentGateway = await startMarketplaceAgentGateway(marketplace, {
    onError: error => { appendLog('desktop', `[marketplace-agent] ${String(error)}`) },
  })
  installIpc()
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(allowsRuntimeClipboardWrite({
      isMainFrame: details.isMainFrame,
      permission,
      requestingOrigin: details.requestingUrl === undefined
        ? originOf(webContents.getURL())
        : originOf(details.requestingUrl),
      ...(details.requestingUrl === undefined ? {} : { requestingUrl: details.requestingUrl }),
      runtimeOrigin,
      webContentsIsMainWindow: webContents === mainWindow?.webContents,
    }))
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return allowsRuntimeClipboardWrite({
      isMainFrame: details.isMainFrame,
      permission,
      requestingOrigin,
      ...(details.requestingUrl === undefined ? {} : { requestingUrl: details.requestingUrl }),
      runtimeOrigin,
      webContentsIsMainWindow: webContents === mainWindow?.webContents,
    })
  })
  const browserSession = session.fromPartition('persist:dsh-studio-browser')
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => { callback(false) })
  browserSession.setPermissionCheckHandler(() => false)
  buildMenu()
  mainWindow = createWindow()
  await showSplash()
  queuedPaths.push(...launchArguments.filter(argument => !argument.startsWith('-')))
  await restartRuntime()

  app.on('activate', () => {
    if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
      mainWindow.show()
      return
    }
    mainWindow = createWindow()
    if (runtimeUrl !== undefined) void mainWindow.loadURL(runtimeUrl.href).then(flushQueuedPaths)
    else void showSplash({ error: true, message: 'DeepSeek Harness 未运行，请从“DSH”菜单重新启动。' })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('before-quit', (event) => {
    if (quitting) return
    if (updateManager?.shouldInstallOnQuit() === true) {
      event.preventDefault()
      quitting = true
      quittingForUpdate = true
      void (async () => {
        await stopForApplicationQuit()
        const result = await updateManager?.command({ type: 'install-now' })
        if (result?.status === 'error') {
          quitting = false
          quittingForUpdate = false
          await restartRuntime()
          await openUpdateWindow()
        }
      })().catch(async (error: unknown) => {
        quitting = false
        quittingForUpdate = false
        appendLog('desktop', `failed to install update on quit: ${error instanceof Error ? error.message : String(error)}`)
        await showSplash({ error: true, message: '更新安装失败。', detail: logTail.slice(-12).join('\n') })
      })
      return
    }
    event.preventDefault()
    quitting = true
    appendLog('desktop', quittingForUpdate ? 'quitting to install desktop update' : 'quitting application')
    void stopForApplicationQuit().finally(() => {
      logStream?.end()
      app.quit()
    })
  })
}

void bootstrap().catch(async (error: unknown) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  appendLog('desktop', detail)
  if (app.isReady()) await showSplash({ error: true, message: `${instanceProductName()} 启动失败。`, detail })
  else {
    await app.whenReady()
    await showSplash({ error: true, message: `${instanceProductName()} 启动失败。`, detail })
  }
})

/**
 * Electron window ownership: main/preview/splash/update-window creation,
 * the window registries used by IPC/broadcast surfaces, the dock icon,
 * and the navigation guards (kernel-refactor leaf-2.3, target-design
 * §4.2).
 *
 * Lifecycle decisions stay in AppController; this module only adapts
 * Electron BrowserWindow APIs and keeps the registries those adapters and
 * ipc.ts read. Host facts (channel, runtime origins, shell asset paths,
 * update manager) arrive through WindowsHost at composition time.
 */
import { app, BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SplashRequest, WindowHandle } from './app-controller.ts'
import type { DshStudioChannel } from './data-root.ts'
import { DSH_STUDIO_DEV_CHANNEL } from './data-root.ts'
import { windowTitleForChannel } from './desktop-identity.ts'
import type { DesktopUpdateManager } from './update-manager.ts'
import { attachEditingContextMenu } from './menu.ts'

const DEFAULT_UI_ZOOM_FACTOR = 1.12
// macOS traffic-light geometry, single-sourced for both the BrowserWindow
// chrome (createWindow) and the chrome-geometry IPC the renderer reads: the
// anchor offsets the unified top rail and the cluster width is three 12px
// buttons with 8px gaps (Apple HIG) = 52px.
export const TRAFFIC_LIGHT_POSITION = { x: 16, y: 14 } as const
export const TRAFFIC_LIGHT_WIDTH = 52
export const TRAFFIC_LIGHT_HEIGHT = 12

/** Shell asset locations derived once in src/main.ts from its own URL. */
export interface ShellAssetPaths {
  preloadPath: string
  repoRoot: string
  splashPath: string
  updateHtmlPath: string
  updatePreloadPath: string
}

export interface WindowsHost {
  channel(): DshStudioChannel
  runtimeOrigin(): string | undefined
  previewOrigin(): string | undefined
  /** Lazily-created desktop update manager singleton. */
  updateManager(): Promise<DesktopUpdateManager>
}

export interface WindowsModule {
  applyInstanceIcon(): void
  mainWindow(): BrowserWindow | undefined
  previewWindow(): BrowserWindow | undefined
  updateWindow(): BrowserWindow | undefined
  mainWindowHandle(): WindowHandle | undefined
  ensureMainWindowHandle(): WindowHandle
  createPreviewWindowHandle(pluginId: string): WindowHandle
  showSplash(request?: SplashRequest): Promise<void>
  openUpdateWindow(): Promise<void>
  closeUpdateWindow(): void
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

/** Best-effort hand-off of an http(s) URL to the system browser. */
function openExternalHttp(url: string): void {
  if (url.startsWith('https:') || url.startsWith('http:')) void shell.openExternal(url)
}

export function createWindowsModule(host: WindowsHost, assets: ShellAssetPaths): WindowsModule {
  // Electron window registries used by IPC/broadcast surfaces only; their
  // creation, loading, and teardown are driven by the controller's ports.
  let mainWindow: BrowserWindow | undefined
  let previewWindow: BrowserWindow | undefined
  let updateWindow: BrowserWindow | undefined

  function isAllowedBrowserNavigation(target: string): boolean {
    if (target === 'about:blank') return true
    try {
      const url = new URL(target)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
      return url.origin !== host.runtimeOrigin() && url.origin !== host.previewOrigin()
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
    if (host.channel() === DSH_STUDIO_DEV_CHANNEL) {
      for (const relative of ['assets/icons-dev/1024x1024.png', 'assets/icons-dev/512x512.png']) {
        const candidate = join(assets.repoRoot, relative)
        if (existsSync(candidate)) return candidate
      }
    }
    const development = join(assets.repoRoot, 'assets', 'icons', '512x512.png')
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
      title: options.title ?? windowTitleForChannel(host.channel()),

      // Platform chrome (mirrors the reference desktop distribution):
      // macOS keeps the inset traffic lights and sidebar vibrancy; Windows
      // uses an overlay caption row over a transparent acrylic body; other
      // platforms run frameless-transparent so the renderer owns the chrome.
      titleBarStyle: platform === 'darwin' ? 'hiddenInset' : 'hidden',
      ...(platform === 'darwin'
        ? {
          // Vertically center the traffic lights on the 42px unified top
          // rail: the cluster is 14px tall, so y = (42 - 14) / 2 = 14.
          trafficLightPosition: { ...TRAFFIC_LIGHT_POSITION },
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
        preload: assets.preloadPath,
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
    })
    window.webContents.setWindowOpenHandler(({ url }) => {
      openExternalHttp(url)
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
        openExternalHttp(url)
        return { action: 'deny' }
      })
      contents.on('will-navigate', (event, url) => {
        if (isAllowedBrowserNavigation(url)) return
        event.preventDefault()
      })
      attachEditingContextMenu(contents)
    })
    window.webContents.on('will-navigate', (event, url) => {
      const allowedOrigin = options.preview === true ? host.previewOrigin() : host.runtimeOrigin()
      if (isAllowedRuntimeNavigation(url, allowedOrigin)) return
      event.preventDefault()
      openExternalHttp(url)
    })
    attachEditingContextMenu(window.webContents)
    return window
  }

  async function showSplash(options: SplashRequest = {}): Promise<void> {
    if (mainWindow === undefined || mainWindow.isDestroyed()) mainWindow = createWindow()
    const query: Record<string, string> = {}
    if (options.error === true) query.state = 'error'
    if (options.message !== undefined) query.message = options.message
    if (options.detail !== undefined) query.detail = options.detail.slice(0, 4_000)
    await mainWindow.loadFile(assets.splashPath, { query })
  }

  /** Adapt an Electron BrowserWindow onto the controller's WindowHandle. */
  function adaptWindow(window: BrowserWindow, onClosed?: () => void): WindowHandle {
    if (onClosed !== undefined) window.once('closed', onClosed)
    return {
      destroy: () => { window.destroy() },
      focus: () => { window.focus() },
      isDestroyed: () => window.isDestroyed(),
      loadURL: async url => { await window.loadURL(url) },
      onceClosed: listener => {
        // Multiple adapters may observe the same underlying window.
        window.once('closed', listener)
      },
      show: () => { window.show() },
    }
  }

  async function openUpdateWindow(): Promise<void> {
    const manager = await host.updateManager()
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
        preload: assets.updatePreloadPath,
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
    await window.loadFile(assets.updateHtmlPath)
    void manager.check()
  }

  function closeUpdateWindow(): void {
    if (updateWindow !== undefined && !updateWindow.isDestroyed()) updateWindow.close()
  }

  function ensureMainWindowHandle(): WindowHandle {
    if (mainWindow === undefined || mainWindow.isDestroyed()) mainWindow = createWindow()
    return adaptWindow(mainWindow)
  }

  function mainWindowHandle(): WindowHandle | undefined {
    return mainWindow === undefined || mainWindow.isDestroyed() ? undefined : adaptWindow(mainWindow)
  }

  function createPreviewWindowHandle(pluginId: string): WindowHandle {
    const window = createWindow({
      preview: true,
      title: `Preview ${pluginId} — ${windowTitleForChannel(host.channel())}`,
    })
    previewWindow = window
    return adaptWindow(window)
  }

  return {
    applyInstanceIcon,
    closeUpdateWindow,
    createPreviewWindowHandle,
    ensureMainWindowHandle,
    mainWindow: () => mainWindow,
    mainWindowHandle,
    openUpdateWindow,
    previewWindow: () => previewWindow,
    showSplash,
    updateWindow: () => updateWindow,
  }
}

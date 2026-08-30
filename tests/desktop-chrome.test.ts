import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { channelNames, type DesktopInfo } from '../src/contracts.ts'
import type { IpcHost } from '../src/ipc.ts'
import type { MenuHost } from '../src/menu.ts'
import type { WindowsHost } from '../src/windows.ts'

const menuCalls: unknown[] = []
const applicationMenus: unknown[] = []
const externalUrls: string[] = []
type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>
const ipcHandlers = new Map<string, IpcHandler>()

type FakeWebContents = {
  readonly id: number
  setZoomFactor(factor: number): void
  setWindowOpenHandler(handler: (details: { url: string }) => unknown): void
  once(event: string, listener: (...args: unknown[]) => void): void
  on(event: string, listener: (...args: unknown[]) => void): void
}

class FakeBrowserWindow {
  static readonly instances: FakeBrowserWindow[] = []
  readonly webContents: FakeWebContents
  private destroyed = false
  readonly options: Record<string, unknown>
  readonly loadedFiles: Array<{ path: string; query: Record<string, string> | undefined }> = []

  constructor(options: Record<string, unknown>) {
    this.options = options
    this.webContents = {
      id: FakeBrowserWindow.instances.length + 1,
      setZoomFactor: () => {},
      setWindowOpenHandler: () => {},
      once: () => {},
      on: () => {},
    }
    FakeBrowserWindow.instances.push(this)
  }

  static fromWebContents(): undefined { return undefined }
  isDestroyed(): boolean { return this.destroyed }
  destroy(): void { this.destroyed = true }
  close(): void { this.destroyed = true }
  show(): void {}
  focus(): void {}
  once(): void {}
  on(): void {}
  async loadFile(path: string, options?: { query?: Record<string, string> }): Promise<void> {
    this.loadedFiles.push({ path, query: options?.query })
  }
  async loadURL(): Promise<void> {}
}

mock.module('electron', {
  exports: {
    app: {
      getLocale: () => 'en-US',
      quit: () => { menuCalls.push({ type: 'quit' }) },
      getPath: (name: string) => `/tmp/dsh-test-${name}`,
    },
    BrowserWindow: FakeBrowserWindow,
    clipboard: {
      writeText: (text: string) => { menuCalls.push({ type: 'clipboard', text }) },
    },
    Menu: {
      buildFromTemplate: (template: unknown) => {
        applicationMenus.push(template)
        return { popup: () => { menuCalls.push({ type: 'popup' }) } }
      },
      setApplicationMenu: (menu: unknown) => { applicationMenus.push({ installed: menu }) },
    },
    shell: {
      openExternal: async (url: string) => { externalUrls.push(url) },
      openPath: async () => '',
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    ipcMain: {
      handle: (channel: string, handler: IpcHandler) => {
        ipcHandlers.set(channel, handler)
      },
    },
  },
} as unknown as Parameters<typeof mock.module>[1])

const { createMenuModule } = await import('../src/menu.ts')
const { createIpcModule, normalizeWorkspacePaths } = await import('../src/ipc.ts')
const { createWindowsModule } = await import('../src/windows.ts')

function desktopInfo(dshHome: string): DesktopInfo {
  return {
    appDataPath: join(dshHome, 'app-data'),
    channel: 'dev',
    dshHome,
    platform: process.platform,
    preview: null,
    profile: 'desktop',
    version: '0.1.2',
  }
}

function controllerStub() {
  return {
    installLocalPlugin: async () => {},
    restart: async () => {},
    runtimeUrl: () => undefined,
    currentPreviewIdentity: () => null,
  }
}

function findMenuItem(value: unknown, label: string): {
  accelerator?: string
  click?: () => void
} | undefined {
  if (!Array.isArray(value)) return undefined
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as { label?: unknown; submenu?: unknown; accelerator?: unknown; click?: unknown }
    if (record.label === label) {
      return {
        ...(typeof record.accelerator === 'string' ? { accelerator: record.accelerator } : {}),
        ...(typeof record.click === 'function' ? { click: record.click as () => void } : {}),
      }
    }
    const nested = findMenuItem(record.submenu, label)
    if (nested !== undefined) return nested
  }
  return undefined
}

function handlerFor(channel: string): IpcHandler {
  const handler = ipcHandlers.get(channel)
  assert.ok(handler, `IPC handler missing for ${channel}`)
  return handler
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return await handlerFor(channel)(...args)
}

test('menu factory wires Settings and View actions through desktop commands', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-chrome-menu-'))
  try {
    const commands: unknown[] = []
    const host = {
      controller: controllerStub,
      desktopInfo: () => desktopInfo(root),
      userEnvironment: () => ({ status: 'ready', entries: [] }),
      recentLogLines: () => [],
      sendCommand: (command: unknown) => { commands.push(command) },
      chooseWorkspace: async () => {},
      installLocalPlugin: async () => {},
      openUpdateWindow: async () => {},
    }

    createMenuModule(host as unknown as MenuHost).buildMenu()
    const template = applicationMenus.find(Array.isArray)
    assert.ok(template !== undefined, 'menu template should be built')

    const settings = findMenuItem(template, 'Settings…')
    assert.equal(settings?.accelerator, 'CmdOrCtrl+,')
    settings?.click?.()
    assert.deepEqual(commands.at(-1), { type: 'show-settings' })

    const sidebar = findMenuItem(template, 'Toggle Sidebar')
    assert.equal(sidebar?.accelerator, 'CmdOrCtrl+B')
    sidebar?.click?.()
    assert.deepEqual(commands.at(-1), { type: 'toggle-sidebar' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('window factory applies hardened webPreferences and loads the splash', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-chrome-window-'))
  try {
    const host = {
      channel: () => 'dev' as const,
      runtimeOrigin: () => 'http://127.0.0.1:9000',
      previewOrigin: () => undefined,
      updateManager: async () => ({}) as never,
    }
    const windows = createWindowsModule(host as unknown as WindowsHost, {
      preloadPath: join(root, 'preload.cjs'),
      repoRoot: root,
      splashPath: join(root, 'splash.html'),
      updateHtmlPath: join(root, 'update.html'),
      updatePreloadPath: join(root, 'update-preload.cjs'),
    })

    await windows.showSplash({ message: 'ready' })
    const created = FakeBrowserWindow.instances.at(-1)
    assert.ok(created, 'showSplash should create a main window')
    const prefs = created.options.webPreferences as Record<string, unknown>
    assert.equal(prefs.contextIsolation, true)
    assert.equal(prefs.nodeIntegration, false)
    assert.equal(prefs.sandbox, true)
    assert.deepEqual(created.loadedFiles.at(-1), {
      path: join(root, 'splash.html'),
      query: { message: 'ready' },
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('normalizeWorkspacePaths accepts existing directories/files and deduplicates roots', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-chrome-paths-'))
  const nested = join(root, 'nested')
  const file = join(nested, 'file.txt')
  mkdirSync(nested)
  writeFileSync(file, 'ok')
  try {
    assert.deepEqual(normalizeWorkspacePaths([root, file, nested, join(root, 'missing')]), [root, nested])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('IPC module registers allowlisted channels and enforces update sender and URL policy', async () => {
  const sent: unknown[] = []
  const mainWebContents = { id: 10, send: (channel: string, value?: unknown) => { sent.push({ channel, value }) } }
  const updateWebContents = { id: 20, send: (channel: string, value?: unknown) => { sent.push({ channel, value }) } }
  const window = { isDestroyed: () => false, webContents: mainWebContents }
  const updateWindow = { isDestroyed: () => false, webContents: updateWebContents }
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-chrome-ipc-'))
  try {
    const state = { status: 'idle', currentVersion: '0.1.2' } as const
    const manager = {
      getState: async () => state,
      command: async () => state,
    }
    const host = {
      controller: controllerStub,
      windows: {
        mainWindow: () => window,
        previewWindow: () => undefined,
        updateWindow: () => updateWindow,
      },
      marketplace: () => undefined,
      updateManager: async () => manager,
      desktopInfo: () => desktopInfo(root),
      runtimeSnapshot: () => ({ bundledPlugins: [], logTail: [], profile: 'desktop', runtimeUrl: null }),
    }
    const ipc = createIpcModule(host as unknown as IpcHost)
    ipc.install()

    assert.ok(ipcHandlers.has(channelNames.chromeGeometry))
    assert.ok(ipcHandlers.has(channelNames.openExternal))
    assert.ok(ipcHandlers.has(channelNames.updateGetState))
    assert.ok(ipcHandlers.has(channelNames.pluginMarketplaceDispatch))

    ipc.sendCommand({ type: 'toggle-sidebar' })
    assert.deepEqual(sent.at(-1), { channel: channelNames.command, value: { type: 'toggle-sidebar' } })

    const geometry = await invoke(channelNames.chromeGeometry, { sender: mainWebContents })
    assert.equal((geometry as { trafficLightWidth: number }).trafficLightWidth, 52)

    await assert.rejects(
      invoke(channelNames.openExternal, { sender: mainWebContents }, 'file:///etc/passwd'),
      /unsupported external URL protocol/,
    )
    await invoke(channelNames.openExternal, { sender: mainWebContents }, 'https://example.com/docs')
    assert.deepEqual(externalUrls.at(-1), 'https://example.com/docs')

    await assert.rejects(
      invoke(channelNames.updateGetState, { sender: mainWebContents }),
      /local update window/,
    )
    assert.deepEqual(await invoke(channelNames.updateGetState, { sender: updateWebContents }), state)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('broadcastMarketplaceChanged guards against destroyed windows', () => {
  const sent: unknown[] = []
  const mainWebContents = { id: 10, send: (channel: string) => { sent.push({ channel, source: 'main' }) } }
  const previewWebContents = { id: 11, send: (channel: string) => { sent.push({ channel, source: 'preview' }) } }

  /**
   * Emulate Electron's destroyed-window semantics: once destroyed, the
   * BrowserWindow is a zombie whose `webContents` access throws
   * `Object has been destroyed` instead of returning a usable object.
   */
  function windowHandle(webContents: { id: number; send(channel: string): void }, destroyed: boolean) {
    return {
      get webContents() {
        if (destroyed) throw new Error('Object has been destroyed')
        return webContents
      },
      isDestroyed: () => destroyed,
    }
  }

  function makeHost(overrides: { mainDestroyed?: boolean; previewDestroyed?: boolean }) {
    return {
      controller: controllerStub,
      windows: {
        mainWindow: () => windowHandle(mainWebContents, overrides.mainDestroyed === true),
        previewWindow: () => windowHandle(previewWebContents, overrides.previewDestroyed === true),
        updateWindow: () => undefined,
      },
      marketplace: () => undefined,
      updateManager: () => Promise.resolve({} as never),
      desktopInfo: () => ({} as never),
      runtimeSnapshot: () => ({ bundledPlugins: [], logTail: [], profile: 'desktop', runtimeUrl: null }),
    } as unknown as IpcHost
  }

  // 1) Both windows alive → sends to both
  sent.length = 0
  const ipc1 = createIpcModule(makeHost({ mainDestroyed: false, previewDestroyed: false }))
  ipc1.broadcastMarketplaceChanged()
  assert.equal(sent.length, 2)
  assert.equal((sent[0] as { source: string }).source, 'main')
  assert.equal((sent[1] as { source: string }).source, 'preview')

  // 2) Main window destroyed → sends only to preview
  sent.length = 0
  const ipc2 = createIpcModule(makeHost({ mainDestroyed: true, previewDestroyed: false }))
  ipc2.broadcastMarketplaceChanged()
  assert.equal(sent.length, 1)
  assert.equal((sent[0] as { source: string }).source, 'preview')

  // 3) Preview window destroyed → sends only to main
  sent.length = 0
  const ipc3 = createIpcModule(makeHost({ mainDestroyed: false, previewDestroyed: true }))
  ipc3.broadcastMarketplaceChanged()
  assert.equal(sent.length, 1)
  assert.equal((sent[0] as { source: string }).source, 'main')

  // 4) Both windows destroyed → sends to neither (no throw)
  sent.length = 0
  const ipc4 = createIpcModule(makeHost({ mainDestroyed: true, previewDestroyed: true }))
  assert.doesNotThrow(() => { ipc4.broadcastMarketplaceChanged() })
  assert.equal(sent.length, 0)
})

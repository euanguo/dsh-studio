import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mock, test } from 'node:test'
import { channelNames, type DesktopInfo } from '../src/contracts.ts'
import type { IpcHost } from '../src/ipc.ts'
import type { MenuHost } from '../src/menu.ts'

const menuCalls: unknown[] = []
const applicationMenus: unknown[] = []
const externalUrls: string[] = []
type IpcHandler = (...args: unknown[]) => unknown | Promise<unknown>
const ipcHandlers = new Map<string, IpcHandler>()

mock.module('electron', {
  exports: {
    app: {
      getLocale: () => 'en-US',
      quit: () => { menuCalls.push({ type: 'quit' }) },
      getPath: (name: string) => `/tmp/dsh-test-${name}`,
    },
    BrowserWindow: {
      fromWebContents: () => undefined,
    },
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

    const geometry = await handlerFor(channelNames.chromeGeometry)({ sender: mainWebContents })
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
    assert.deepEqual(await handlerFor(channelNames.updateGetState)({ sender: updateWebContents }), state)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

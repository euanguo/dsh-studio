/**
 * IPC handler and push-channel ownership (kernel-refactor leaf-2.3,
 * target-design §4.2). Owns the nine ipcMain handlers (workspace picker,
 * chrome geometry, update state/command, info/runtime snapshot,
 * marketplace snapshot/dispatch, external open) plus the renderer pushes
 * (sendCommand / sendUpdateState / marketplace-changed broadcast) and the
 * workspace/plugin dialog flows shared with the application menu.
 *
 * The module holds no lifecycle state: handlers reach the controller, the
 * window registries, the marketplace manager, and the update manager via
 * IpcHost, which src/main.ts supplies at composition time.
 */
import { app, dialog, ipcMain, shell } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseMarketplaceCommand } from '../plugins/plugin-marketplace/src/protocol.ts'
import type { PluginMarketplaceManager } from '../plugins/plugin-marketplace/src/host/transaction-manager.ts'
import type { AppController } from './app-controller.ts'
import {
  channelNames,
  DESKTOP_UPDATE_COMMAND_TYPES,
  type DesktopCommand,
  type DesktopInfo,
  type DesktopRuntimeSnapshot,
  type DesktopUpdateCommand,
  type DesktopUpdateState,
} from './contracts.ts'
import type { DesktopUpdateManager } from './update-manager.ts'
import { scheduleImmediateUpdateInstall } from './update-lifecycle.ts'
import {
  TRAFFIC_LIGHT_HEIGHT,
  TRAFFIC_LIGHT_POSITION,
  TRAFFIC_LIGHT_WIDTH,
  type WindowsModule,
} from './windows.ts'

/** Host-provided facts and services the IPC handlers compose from. */
export interface IpcHost {
  controller(): AppController
  windows: WindowsModule
  /** Marketplace manager once bootstrap composition has created it. */
  marketplace(): PluginMarketplaceManager | undefined
  updateManager(): Promise<DesktopUpdateManager>
  desktopInfo(preview?: DesktopInfo['preview']): DesktopInfo
  runtimeSnapshot(): DesktopRuntimeSnapshot
}

export interface IpcModule {
  install(): void
  sendCommand(command: DesktopCommand): void
  sendUpdateState(state: DesktopUpdateState): void
  broadcastMarketplaceChanged(): void
  selectWorkspacePaths(): Promise<string[]>
  chooseWorkspace(): Promise<void>
  installLocalPlugin(): Promise<void>
}

export function normalizeWorkspacePaths(paths: readonly string[]): string[] {
  const normalized: string[] = []
  for (const candidate of paths) {
    if (!existsSync(candidate)) continue
    const absolute = resolve(candidate)
    const target = statSync(absolute).isDirectory() ? absolute : dirname(absolute)
    if (!normalized.includes(target)) normalized.push(target)
  }
  return normalized
}

export function createIpcModule(host: IpcHost): IpcModule {
  function sendCommand(command: DesktopCommand): void {
    const window = host.windows.mainWindow()
    if (window === undefined || window.isDestroyed()) return
    window.webContents.send(channelNames.command, command)
  }

  function sendUpdateState(state: DesktopUpdateState): void {
    const window = host.windows.updateWindow()
    if (window === undefined || window.isDestroyed()) return
    window.webContents.send(channelNames.updateState, state)
  }

  /**
   * Push a "marketplace changed" signal to every open marketplace surface
   * (main + preview windows) so a retained store re-pulls the snapshot (D4).
   * The generic desktop-bridge convention is a bare notify with no payload;
   * the store re-fetches on receipt.
   */
  function broadcastMarketplaceChanged(): void {
    const channel = channelNames.pluginMarketplaceChanged
    const main = host.windows.mainWindow()
    if (main !== undefined && !main.isDestroyed()) main.webContents.send(channel)
    const preview = host.windows.previewWindow()
    if (preview !== undefined && !preview.isDestroyed()) preview.webContents.send(channel)
  }

  async function selectWorkspacePaths(): Promise<string[]> {
    const options: Electron.OpenDialogOptions = {
      title: '打开 DSH 工作区',
      properties: ['openDirectory', 'createDirectory'],
    }
    const parent = host.windows.mainWindow()
    const result = parent === undefined || parent.isDestroyed()
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(parent, options)
    return result.canceled ? [] : normalizeWorkspacePaths(result.filePaths)
  }

  async function chooseWorkspace(): Promise<void> {
    const paths = await selectWorkspacePaths()
    if (paths.length > 0) sendCommand({ type: 'open-paths', paths })
  }

  async function choosePluginFolder(): Promise<string | undefined> {
    const options: Electron.OpenDialogOptions = {
      title: '选择 DSH 插件目录',
      buttonLabel: '安装插件',
      properties: ['openDirectory'],
    }
    const parent = host.windows.mainWindow()
    const choice = parent === undefined || parent.isDestroyed()
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(parent, options)
    if (choice.canceled) return undefined
    return choice.filePaths[0]
  }

  async function installLocalPlugin(): Promise<void> {
    const pluginPath = await choosePluginFolder()
    if (pluginPath === undefined) return
    await host.controller().installLocalPlugin(pluginPath)
  }

  function assertUpdateWindowSender(event: { sender: Electron.WebContents }): void {
    const window = host.windows.updateWindow()
    if (window === undefined || window.isDestroyed() || event.sender !== window.webContents) {
      throw new Error('update IPC is only available to the local update window')
    }
  }

  function parseUpdateCommand(raw: unknown): DesktopUpdateCommand {
    if (typeof raw !== 'object' || raw === null || !('type' in raw) || typeof raw.type !== 'string') {
      throw new Error('invalid update command')
    }
    const type = raw.type
    if (!(DESKTOP_UPDATE_COMMAND_TYPES as readonly string[]).includes(type)) {
      throw new Error(`unsupported update command: ${type}`)
    }
    return { type } as DesktopUpdateCommand
  }

  function requireMarketplace(): PluginMarketplaceManager {
    const marketplace = host.marketplace()
    if (marketplace === undefined) throw new Error('plugin marketplace is not initialized')
    return marketplace
  }

  function install(): void {
    ipcMain.handle(channelNames.chooseWorkspace, async () => await selectWorkspacePaths())
    ipcMain.handle(channelNames.chromeGeometry, () => {
      // The unified top rail's left reservation: the traffic-light anchor
      // (trafficLightPosition) plus the exact macOS cluster width (an Apple HIG
      // constant, single-sourced in windows.ts). The renderer adds its breathing gap
      // and turns this into `--dsh-studio-traffic-left`.
      const platform = process.platform
      return {
        platform,
        trafficLight: platform === 'darwin' ? { ...TRAFFIC_LIGHT_POSITION } : null,
        trafficLightWidth: TRAFFIC_LIGHT_WIDTH,
        trafficLightHeight: TRAFFIC_LIGHT_HEIGHT,
      }
    })
    ipcMain.handle(channelNames.updateGetState, async event => {
      assertUpdateWindowSender(event)
      return (await host.updateManager()).getState()
    })
    ipcMain.handle(channelNames.updateCommand, async (event, raw: unknown) => {
      assertUpdateWindowSender(event)
      const command = parseUpdateCommand(raw)
      const manager = await host.updateManager()
      const current = manager.getState()
      const installNow = command.type === 'install-now'
        && current.status === 'downloaded'
        && current.platform !== 'deb'
      if (installNow) {
        return await scheduleImmediateUpdateInstall(manager, () => {
          app.quit()
        })
      }
      return await manager.command(command)
    })
    ipcMain.handle(channelNames.getInfo, event => {
      const previewSender = (() => {
        const previewWindow = host.windows.previewWindow()
        return previewWindow !== undefined && !previewWindow.isDestroyed()
          && previewWindow.webContents.id === event.sender.id
      })()
      const preview = previewSender ? host.controller().currentPreviewIdentity() : null
      return host.desktopInfo(preview)
    })
    ipcMain.handle(channelNames.getRuntimeSnapshot, () => host.runtimeSnapshot())
    ipcMain.handle(channelNames.pluginMarketplaceSnapshot, () => {
      return requireMarketplace().getSnapshot()
    })
    ipcMain.handle(channelNames.pluginMarketplaceDispatch, async (_event, raw: unknown) => {
      const marketplace = requireMarketplace()
      const snapshot = await marketplace.dispatch(parseMarketplaceCommand(raw))
      broadcastMarketplaceChanged()
      return snapshot
    })
    ipcMain.handle(channelNames.openExternal, async (_event, raw: unknown) => {
      if (typeof raw !== 'string') throw new Error('external URL must be a string')
      const url = new URL(raw)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error(`unsupported external URL protocol: ${url.protocol}`)
      }
      await shell.openExternal(url.href)
    })
  }

  return {
    broadcastMarketplaceChanged,
    chooseWorkspace,
    install,
    installLocalPlugin,
    sendCommand,
    sendUpdateState,
    selectWorkspacePaths,
  }
}

import { contextBridge, ipcRenderer } from 'electron'
import type { ChromeGeometry, DesktopBridge, DesktopCommand, DesktopInfo, DesktopRuntimeSnapshot } from './contracts.ts'
import { channelNames } from './contracts.ts'
import type { MarketplaceCommand, MarketplaceSnapshot } from '../plugins/plugin-marketplace/src/protocol.ts'

const bridge: DesktopBridge = Object.freeze({
  chooseWorkspace: async (): Promise<string[]> => {
    return await ipcRenderer.invoke(channelNames.chooseWorkspace) as string[]
  },
  getInfo: async (): Promise<DesktopInfo> => await ipcRenderer.invoke(channelNames.getInfo) as DesktopInfo,
  getRuntimeSnapshot: async (): Promise<DesktopRuntimeSnapshot> => {
    return await ipcRenderer.invoke(channelNames.getRuntimeSnapshot) as DesktopRuntimeSnapshot
  },
  onCommand: (listener: (command: DesktopCommand) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, command: DesktopCommand): void => { listener(command) }
    ipcRenderer.on(channelNames.command, wrapped)
    return () => { ipcRenderer.removeListener(channelNames.command, wrapped) }
  },
  openExternal: async (url: string): Promise<void> => {
    await ipcRenderer.invoke(channelNames.openExternal, url)
  },
  chrome: Object.freeze({
    getGeometry: async (): Promise<ChromeGeometry> => {
      return await ipcRenderer.invoke(channelNames.chromeGeometry) as ChromeGeometry
    },
  }),
  pluginMarketplace: Object.freeze({
    dispatch: async (command: MarketplaceCommand): Promise<MarketplaceSnapshot> => {
      return await ipcRenderer.invoke(channelNames.pluginMarketplaceDispatch, command) as MarketplaceSnapshot
    },
    getSnapshot: async (): Promise<MarketplaceSnapshot> => {
      return await ipcRenderer.invoke(channelNames.pluginMarketplaceSnapshot) as MarketplaceSnapshot
    },
    onSnapshotChanged: (listener: () => void): (() => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent): void => { listener() }
      ipcRenderer.on(channelNames.pluginMarketplaceChanged, wrapped)
      return () => { ipcRenderer.removeListener(channelNames.pluginMarketplaceChanged, wrapped) }
    },
  }),
})

contextBridge.exposeInMainWorld('dshDesktop', bridge)
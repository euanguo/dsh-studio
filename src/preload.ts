import { contextBridge, ipcRenderer } from 'electron'
import type { ChromeGeometry, DesktopBridge, DesktopCommand, DesktopInfo, DesktopRuntimeSnapshot } from './contracts.ts'
import type { MarketplaceCommand, MarketplaceSnapshot } from '../plugins/plugin-marketplace/src/protocol.ts'

const bridge: DesktopBridge = Object.freeze({
  chooseWorkspace: async (): Promise<string[]> => {
    return await ipcRenderer.invoke('desktop:choose-workspace') as string[]
  },
  getInfo: async (): Promise<DesktopInfo> => await ipcRenderer.invoke('desktop:get-info') as DesktopInfo,
  getRuntimeSnapshot: async (): Promise<DesktopRuntimeSnapshot> => {
    return await ipcRenderer.invoke('desktop:get-runtime-snapshot') as DesktopRuntimeSnapshot
  },
  onCommand: (listener: (command: DesktopCommand) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, command: DesktopCommand): void => { listener(command) }
    ipcRenderer.on('desktop:command', wrapped)
    return () => { ipcRenderer.removeListener('desktop:command', wrapped) }
  },
  openExternal: async (url: string): Promise<void> => {
    await ipcRenderer.invoke('desktop:open-external', url)
  },
  chrome: Object.freeze({
    getGeometry: async (): Promise<ChromeGeometry> => {
      return await ipcRenderer.invoke('desktop:chrome-geometry') as ChromeGeometry
    },
  }),
  pluginMarketplace: Object.freeze({
    dispatch: async (command: MarketplaceCommand): Promise<MarketplaceSnapshot> => {
      return await ipcRenderer.invoke('desktop:plugin-marketplace-dispatch', command) as MarketplaceSnapshot
    },
    getSnapshot: async (): Promise<MarketplaceSnapshot> => {
      return await ipcRenderer.invoke('desktop:plugin-marketplace-snapshot') as MarketplaceSnapshot
    },
  }),
})

contextBridge.exposeInMainWorld('dshDesktop', bridge)

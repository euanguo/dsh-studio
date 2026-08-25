import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopUpdateBridge, DesktopUpdateCommand, DesktopUpdateState } from './contracts.ts'
import { channelNames, DESKTOP_UPDATE_COMMAND_TYPES } from './contracts.ts'

const commandTypes = new Set<DesktopUpdateCommand['type']>(DESKTOP_UPDATE_COMMAND_TYPES)

function isCommand(value: unknown): value is DesktopUpdateCommand {
  return typeof value === 'object'
    && value !== null
    && 'type' in value
    && typeof value.type === 'string'
    && commandTypes.has(value.type as DesktopUpdateCommand['type'])
}

const bridge: DesktopUpdateBridge = Object.freeze({
  getState: async (): Promise<DesktopUpdateState> => await ipcRenderer.invoke(channelNames.updateGetState) as DesktopUpdateState,
  command: async (command: DesktopUpdateCommand): Promise<DesktopUpdateState> => {
    if (!isCommand(command)) throw new Error('unsupported update command')
    return await ipcRenderer.invoke(channelNames.updateCommand, command) as DesktopUpdateState
  },
  onState: (listener: (state: DesktopUpdateState) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState): void => { listener(state) }
    ipcRenderer.on(channelNames.updateState, wrapped)
    return () => { ipcRenderer.removeListener(channelNames.updateState, wrapped) }
  },
})

contextBridge.exposeInMainWorld('dshDesktopUpdate', bridge)
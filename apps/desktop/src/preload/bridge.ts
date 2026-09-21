import { contextBridge, ipcRenderer } from "electron"
import {
  desktopChannels as channels,
  type DesktopBridge,
  type DesktopState,
  type Preparation,
  type CloseAction,
  type CloseCommit,
} from "../shared/desktop-bridge"

const bridge: DesktopBridge = Object.freeze({
  state: () => ipcRenderer.invoke(channels.state),
  ready: () => ipcRenderer.invoke(channels.ready),
  observe(listener: (state: DesktopState) => void) {
    const receive = (_event: Electron.IpcRendererEvent, state: DesktopState) => listener(state)
    ipcRenderer.on(channels.changed, receive)
    return () => ipcRenderer.removeListener(channels.changed, receive)
  },
  prepared: (result: Preparation) => ipcRenderer.invoke(channels.prepared, result),
  closeAction: (action: CloseAction) => ipcRenderer.invoke(channels.action, action),
  commitClose: (commit: CloseCommit) => ipcRenderer.invoke(channels.commit, commit),
})
export function installDesktopBridge() {
  contextBridge.exposeInMainWorld("locusDesktop", bridge)
}

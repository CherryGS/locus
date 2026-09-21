import { app, BrowserWindow, Menu, nativeTheme, shell } from "electron"
import { join } from "node:path"
import { externalLinkHandler } from "./external-links"

function createWindow() {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: "Locus",
    backgroundColor: "#18181b",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#18181b",
      symbolColor: "#a1a1aa",
      height: 40,
    },
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  window.once("ready-to-show", () => window.show())
  window.webContents.setWindowOpenHandler(externalLinkHandler((url) => shell.openExternal(url)))

  // This review consumer intentionally has no backend or preload capability.
  // The connected desktop will load the authorized Axum origin here.
  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    void window.loadURL(rendererUrl)
  } else {
    void window.loadFile(join(import.meta.dirname, "../renderer/index.html"))
  }
}

export function startDesktop() {
  app.setName("Locus")
  nativeTheme.themeSource = "dark"
  Menu.setApplicationMenu(null)

  void app.whenReady().then(() => {
    createWindow()
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit()
  })
}

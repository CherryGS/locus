import {
  app,
  BrowserWindow,
  Menu,
  nativeTheme,
  shell,
  session,
  ipcMain,
  dialog,
  type IpcMainInvokeEvent,
} from "electron"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { externalLinkHandler } from "./external-links"
import { authorizedHeaders, isRendererPage } from "./authorization"
import { launchBackend, drainBackend, type Backend } from "./backend"
import { CloseGate } from "./close-gate"
import {
  desktopChannels as channels,
  isCloseAction,
  isCloseCommit,
  isPreparation,
  type Connection,
  type DesktopState,
} from "../shared/desktop-bridge"

export function startDesktop() {
  app.setName("Locus")
  nativeTheme.themeSource = "dark"
  Menu.setApplicationMenu(null)
  let window: BrowserWindow | undefined
  let child: ChildProcessWithoutNullStreams | undefined
  let backend: Backend | undefined
  let connection: Connection = { status: "starting" }
  let exiting = false
  let pageAvailable = false
  let nativePrompt = false
  let drainCommitted = false
  let drainRequest: Promise<void> | undefined
  let preparationTimer: ReturnType<typeof setTimeout> | undefined
  const startup = new AbortController()
  const close = new CloseGate()
  const state = (): DesktopState => ({ connection, close: close.state })
  const changed = () => {
    if (window && !window.isDestroyed()) window.webContents.send(channels.changed, state())
  }
  const sender = (event: IpcMainInvokeEvent) => {
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      !backend ||
      !isRendererPage(event.senderFrame.url, backend.origin)
    )
      throw new Error("Untrusted desktop sender")
  }
  const finish = () => {
    exiting = true
    startup.abort()
    window?.destroy()
    app.quit()
  }
  function waitForPreparation() {
    clearTimeout(preparationTimer)
    const attempt = close.state
    preparationTimer = setTimeout(() => {
      if (close.state === attempt)
        void unavailable(
          "The renderer has not completed the preference-preparation handoff. Saving readiness cannot be established."
        )
    }, 15_000)
  }

  function commitDrain() {
    drainCommitted = true
    clearTimeout(preparationTimer)
    if (drainRequest) return drainRequest
    const request = drain()
    drainRequest = request
    void request.then(() => {
      if (drainRequest === request) drainRequest = undefined
    })
    return request
  }
  async function drain() {
    changed()
    if (!backend || backend.child.exitCode !== null || backend.child.signalCode !== null) {
      if (backend?.child.exitCode === 0) finish()
      else
        await unavailable(
          "The backend is unavailable. Preference confirmation and accepted-work completion cannot be established."
        )
      return
    }
    try {
      const result = await drainBackend(backend)
      if (close.state.phase === "draining") close.state = { ...close.state, active: result.active_operations }
      changed()
      await backend.exited
    } catch {
      if (backend.child.exitCode === 0) finish()
      else
        await unavailable(
          "Closing could not confirm backend drain. New admissions may already be closed; Locus cannot return to ordinary saving. Check closing to repeat the same drain request."
        )
    }
  }
  async function unavailable(message: string) {
    if (nativePrompt || exiting || !window || window.isDestroyed()) return
    nativePrompt = true
    clearTimeout(preparationTimer)
    const alive = !!backend && backend.child.exitCode === null && backend.child.signalCode === null
    const irreversible = drainCommitted
    const nativeAttempt = close.state.phase === "idle" ? undefined : close.state.attemptId
    const result = await dialog.showMessageBox(window, {
      type: "warning",
      title: "Locus",
      message,
      buttons: irreversible
        ? alive
          ? ["Keep waiting", "Check closing"]
          : ["Close Locus"]
        : alive
          ? ["Return to Locus", "Continue closing"]
          : ["Return to Locus", "Close Locus"],
      defaultId: 0,
      cancelId: 0,
      detail: irreversible
        ? "Exit has been committed. Accepted work is not canceled and ordinary saving cannot be reopened."
        : alive
          ? "Unconfirmed preferences may not be saved. Returning leaves accepted work running. Continuing waits for accepted work."
          : backend
            ? "Earlier operation outcomes cannot be established. Restart Locus to read the actual saved library state."
            : "Check the selected library and built artifacts, then restart Locus.",
    })
    nativePrompt = false
    if (exiting) return
    if (drainCommitted) {
      const stillAlive = !!backend && backend.child.exitCode === null && backend.child.signalCode === null
      if (!stillAlive) {
        finish()
        return
      }
      if (result.response === 1) {
        drainRequest = undefined
        void commitDrain()
      }
      return
    }
    if (nativeAttempt && (close.state.phase === "idle" || close.state.attemptId !== nativeAttempt)) return
    if (result.response === 0) {
      close.state = { phase: "idle" }
      changed()
      return
    }
    if (backend && backend.child.exitCode === null && backend.child.signalCode === null) {
      // Native fallback consent is used only when the renderer cannot prepare.
      // Disable user input synchronously at that boundary so no later explicit
      // view choice can be accepted while the backend admission gate closes.
      window.setEnabled(false)
      close.state = { phase: "draining", attemptId: randomUUID() }
      await commitDrain()
    } else if (!child || child.exitCode !== null || child.signalCode !== null) finish()
    else {
      // A pre-readiness child has received no renderer work and must not outlive its host.
      child.once("exit", finish)
      child.kill()
    }
  }
  function requestClose() {
    if (exiting || nativePrompt) return
    if (drainCommitted) {
      void unavailable("Locus is waiting for accepted work to finish.")
      return
    }
    if (close.state.phase !== "idle") return
    if (connection.status !== "ready" || !pageAvailable) {
      void unavailable(
        connection.status === "failed" || connection.status === "lost"
          ? connection.message
          : "The renderer cannot prepare preferences for closing."
      )
      return
    }
    close.begin(randomUUID())
    changed()
    waitForPreparation()
  }

  ipcMain.handle(channels.state, (event) => {
    sender(event)
    return state()
  })
  ipcMain.handle(channels.ready, (event) => {
    sender(event)
    pageAvailable = true
  })
  ipcMain.handle(channels.prepared, (event, value: unknown) => {
    sender(event)
    if (!isPreparation(value)) throw new Error("Invalid preparation")
    if (nativePrompt) return
    if (close.prepared(value)) {
      clearTimeout(preparationTimer)
      if (close.state.phase === "sealing") waitForPreparation()
      changed()
    }
  })
  ipcMain.handle(channels.action, (event, value: unknown) => {
    sender(event)
    if (!isCloseAction(value)) throw new Error("Invalid close action")
    if (close.action(value)) {
      clearTimeout(preparationTimer)
      changed()
    }
  })
  ipcMain.handle(channels.commit, (event, value: unknown) => {
    sender(event)
    if (!isCloseCommit(value)) throw new Error("Invalid close commit")
    if (!nativePrompt && close.commit(value)) void commitDrain()
  })

  void app.whenReady().then(async () => {
    const ownedSession = session.fromPartition(`locus-${randomUUID()}`)
    window = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 720,
      minHeight: 480,
      show: false,
      title: "Locus",
      backgroundColor: "#18181b",
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#18181b", symbolColor: "#a1a1aa", height: 40 },
      webPreferences: {
        preload: join(import.meta.dirname, "../preload/index.cjs"),
        session: ownedSession,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    window.on("close", (event) => {
      if (!exiting) {
        event.preventDefault()
        requestClose()
      }
    })
    window.once("ready-to-show", () => {
      if (process.env.LOCUS_DESKTOP_HIDDEN !== "1") window?.show()
    })
    window.webContents.setWindowOpenHandler(externalLinkHandler((url) => shell.openExternal(url)))
    window.webContents.on("will-navigate", (event, url) => {
      if (!backend || !isRendererPage(url, backend.origin)) event.preventDefault()
    })
    window.webContents.on("will-redirect", (event) => event.preventDefault())
    window.webContents.on("will-attach-webview", (event) => event.preventDefault())
    window.webContents.on("render-process-gone", () => {
      pageAvailable = false
      if (!drainCommitted) close.state = { phase: "idle" }
      void unavailable("The renderer stopped. Preference preparation is unavailable.")
    })
    window.webContents.on("unresponsive", () => {
      if (close.state.phase !== "idle")
        void unavailable("The renderer is not responding. Preference preparation is unavailable.")
    })
    ownedSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    const redirects = new Set<number>()
    ownedSession.webRequest.onBeforeRedirect((details) => redirects.add(details.id))
    ownedSession.webRequest.onCompleted((details) => redirects.delete(details.id))
    ownedSession.webRequest.onErrorOccurred((details) => redirects.delete(details.id))
    ownedSession.webRequest.onBeforeSendHeaders((details, callback) => {
      if (!backend || connection.status !== "ready" || !window) {
        callback({ cancel: true })
        return
      }
      const frame = details.frame
      let frameOrigin: string | undefined
      try {
        frameOrigin = frame?.url ? new URL(frame.url).origin : undefined
      } catch {
        /* bootstrap blank frame */
      }
      callback(
        authorizedHeaders(
          {
            url: details.url,
            mainFrame: frame === window.webContents.mainFrame,
            ownedWindow: details.webContentsId === window.webContents.id,
            frameOrigin,
            initiatorOrigin: details.initiatorOrigin,
            resourceType: details.resourceType,
            redirected: redirects.has(details.id),
          },
          backend.origin,
          backend.runId,
          backend.credential,
          details.requestHeaders
        )
      )
    })
    try {
      backend = await launchBackend((value) => {
        child = value
      }, startup.signal)
      if (exiting) return
      connection = { status: "ready", origin: backend.origin, runId: backend.runId }
      void backend.exited.then(({ code }) => {
        if (exiting) return
        connection = {
          status: "lost",
          message: "The backend stopped. Restart Locus to reconnect; pending choices have not been confirmed saved.",
        }
        changed()
        if (drainCommitted && code === 0) finish()
        else if (drainCommitted || !pageAvailable || close.state.phase !== "idle") void unavailable(connection.message)
      })
      await window.loadURL(`${backend.origin}/#/entity`)
    } catch (error) {
      if (exiting || window.isDestroyed()) return
      connection = { status: "failed", message: error instanceof Error ? error.message : "Locus could not start." }
      if (!backend && child && child.exitCode === null) child.kill()
      if (process.env.LOCUS_DESKTOP_HIDDEN !== "1") window.show()
      void unavailable(connection.message)
    }
  })
  app.on("before-quit", (event) => {
    if (!exiting) {
      event.preventDefault()
      requestClose()
    }
  })
  app.on("window-all-closed", () => {
    if (exiting) app.quit()
    else requestClose()
  })
}

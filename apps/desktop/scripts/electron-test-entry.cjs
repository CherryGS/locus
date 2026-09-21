// Test-only entry: suppress native dialogs before the actual production host is
// imported. All choices are controlled by the isolated test, never user focus.
const { app, dialog } = require("electron")
app.commandLine.appendSwitch("disable-background-timer-throttling")
app.commandLine.appendSwitch("disable-renderer-backgrounding")
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows")
const childProcess = require("node:child_process")
const { syncBuiltinESMExports } = require("node:module")
const { writeFileSync } = require("node:fs")
globalThis.__desktopTest = {
  dialogs: [],
  fileDialogs: [],
  fileSelections: [],
  children: [],
  responses: [],
  states: [],
  drainRequests: 0,
  drainDeliveries: [],
}
app.on("browser-window-created", (_event, window) => {
  window.webContents.setBackgroundThrottling(false)
  const send = window.webContents.send.bind(window.webContents)
  window.webContents.send = (channel, ...args) => {
    if (channel === "locus:changed") globalThis.__desktopTest.states.push(args[0])
    return send(channel, ...args)
  }
})
const originalFetch = globalThis.fetch
globalThis.fetch = async (...args) => {
  const request = new Request(...args)
  const response = await originalFetch(request)
  if (request.method === "POST" && new URL(request.url).pathname === "/api/v1/drain") {
    globalThis.__desktopTest.drainRequests++
    globalThis.__desktopTest.drainDeliveries.push({
      method: request.method,
      url: request.url,
      runId: request.headers.get("X-Locus-Run"),
    })
    if (process.env.LOCUS_TEST_DROP_DRAIN_ONCE === "1" && globalThis.__desktopTest.drainRequests === 1)
      throw new Error("Isolated lost drain response after application")
  }
  return response
}
const spawn = childProcess.spawn
childProcess.spawn = (...args) => {
  const child = spawn(...args)
  globalThis.__desktopTest.children.push(child)
  const end = child.stdin.end.bind(child.stdin)
  child.stdin.end = (chunk, ...rest) => {
    try {
      globalThis.__desktopTest.bootstrap = JSON.parse(String(chunk))
    } catch {}
    return end(chunk, ...rest)
  }
  let ready = ""
  child.stdout.on("data", (bytes) => {
    ready += String(bytes)
    if (ready.includes("\n")) {
      try {
        globalThis.__desktopTest.ready = JSON.parse(ready.split("\n")[0])
      } catch {}
    }
  })
  return child
}
syncBuiltinESMExports()
dialog.showMessageBox = async (_window, options) => {
  globalThis.__desktopTest.dialogs.push(options)
  if (process.env.LOCUS_TEST_DIALOG_RESPONSE !== undefined) {
    if (process.env.LOCUS_TEST_DIALOG_LOG)
      writeFileSync(
        process.env.LOCUS_TEST_DIALOG_LOG,
        JSON.stringify({ options, childCount: globalThis.__desktopTest.children.length })
      )
    return { response: Number(process.env.LOCUS_TEST_DIALOG_RESPONSE), checkboxChecked: false }
  }
  return new Promise((resolve) =>
    globalThis.__desktopTest.responses.push((response) => resolve({ response, checkboxChecked: false }))
  )
}
dialog.showOpenDialog = async (_window, options) => {
  globalThis.__desktopTest.fileDialogs.push(options)
  return globalThis.__desktopTest.fileSelections.shift() ?? { canceled: true, filePaths: [] }
}
void import("../out/main/index.js")

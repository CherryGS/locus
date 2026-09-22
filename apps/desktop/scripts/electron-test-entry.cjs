// Test-only entry: suppress native dialogs before the actual production host is
// imported. All choices are controlled by the isolated test, never user focus.
const { app, dialog, shell } = require("electron")
app.commandLine.appendSwitch("disable-background-timer-throttling")
app.commandLine.appendSwitch("disable-renderer-backgrounding")
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows")
const childProcess = require("node:child_process")
const { syncBuiltinESMExports } = require("node:module")
const { writeFileSync, appendFileSync, readFileSync } = require("node:fs")
const { createHash } = require("node:crypto")
globalThis.__desktopTest = {
  externalLinks: [],
  rejectExternal: true,
  holdExternal: false,
  externalRejections: [],
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
    if (process.env.LOCUS_TEST_RELAUNCH_LOG) {
      const status = await response.clone().json()
      appendFileSync(process.env.LOCUS_TEST_RELAUNCH_LOG, JSON.stringify({at:Date.now(),host:process.pid,event:"drain",active:status.active_operations,run:status.run_id}) + "\n")
    }
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
  if (process.env.LOCUS_TEST_RETRY_BINARY && !globalThis.__desktopTest.retriedBinary) {
    globalThis.__desktopTest.retriedBinary = true
    process.env.LOCUS_SERVER_BINARY = process.env.LOCUS_TEST_RETRY_BINARY
    return { response: 0, checkboxChecked: false }
  }
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
if (process.env.LOCUS_TEST_EXTERNAL_LINKS === "1") {
  shell.openExternal = async url => {
    globalThis.__desktopTest.externalLinks.push(url)
    if (globalThis.__desktopTest.holdExternal) return new Promise((_resolve, reject) => globalThis.__desktopTest.externalRejections.push(() => reject(new Error("Delayed test rejection"))))
    if (globalThis.__desktopTest.rejectExternal) throw new Error("Test-owned rejected browser handoff")
  }
}
void import("../out/main/index.js")

// Optional process-level restart evidence. Never write the bootstrap credential.
if (process.env.LOCUS_TEST_RELAUNCH_LOG) {
  const log = process.env.LOCUS_TEST_RELAUNCH_LOG
  const emit = value => appendFileSync(log, JSON.stringify({ at: Date.now(), host: process.pid, ...value }) + "\n")
  const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
  const prior = (() => { try { return readFileSync(log,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse) } catch { return [] } })()
  const replacement = process.argv.includes("--locus-require-existing")
  const previous = prior.findLast(event => event.event === "ready")
  emit({ event:"host-start", replacement, previousHostAlive: previous ? alive(previous.host) : undefined, previousBackendAlive: previous ? alive(previous.backend) : undefined })
  const relaunch = app.relaunch.bind(app)
  app.relaunch = options => { emit({ event:"relaunch", args:options.args }); return relaunch(options) }
  app.on("quit", () => emit({event:"host-quit"}))
  app.on("browser-window-created", (_event, window) => {
    window.webContents.on("did-finish-load", async () => {
      const test = globalThis.__desktopTest
      const ready = test.ready, bootstrap = test.bootstrap, child = test.children.at(-1)
      if (!ready || !bootstrap) return
      child.once("exit", (code, signal) => emit({event:"backend-exit",backend:child.pid,code,signal}))
      const read = async path => (await originalFetch(ready.origin+path,{headers:{Authorization:`Bearer ${bootstrap.credential}`,"X-Locus-Run":ready.run_id}})).json()
      emit({event:"ready",backend:child.pid,run:ready.run_id,library:ready.library_root,availability:ready.availability,credentialDigest:createHash("sha256").update(bootstrap.credential).digest("hex"),runtime:await read("/api/v1/settings/media-runtime"),page:await window.webContents.executeJavaScript("({hash:location.hash,history:history.length,settingsFields:document.querySelectorAll('#media-ffprobe').length})")})
      if (replacement || process.env.LOCUS_TEST_CLOSE_READY === "1") {
        // The replacement is bounded and exits through its actual fresh renderer/host gate.
        await window.webContents.executeJavaScript("window.locusDesktop.ready().then(()=>window.locusDesktop.requestLifecycle('close'))")
      }
    })
  })
  setTimeout(() => { emit({event:"test-deadline"}); for(const child of globalThis.__desktopTest.children) if(child.exitCode===null) child.kill(); app.exit(91) }, 90000).unref()
}

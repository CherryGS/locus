import { chooseContentView } from "./content-view-choice.ts"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { access, readFile, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { createServer } from "node:net"
import { once } from "node:events"
import { join } from "node:path"
import { _electron as electron, type ElectronApplication, type Page } from "playwright"
import { fixture, desktop, workspace, outputDirectory } from "./fixture.ts"
// Native startup checks require the production startup-failure protocol.
// Fixture seeding remains under fixture.ts; explicit binary overrides still apply.
const binary =
  process.env.LOCUS_SERVER_BINARY ??
  join(workspace, "target/debug", process.platform === "win32" ? "locus-server.exe" : "locus-server")
const require = createRequire(import.meta.url),
  data = await fixture(),
  output = await outputDirectory("settings-native")
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
)
delete env.ELECTRON_RUN_AS_NODE
delete env.LOCUS_FFPROBE
delete env.LOCUS_FFMPEG
let application: ElectronApplication | undefined
const checks: string[] = []
let launchNumber = 0
async function launchApplication(extra: Record<string, string> = {}, args: string[] = []) {
  application = await electron.launch({
    executablePath: require("electron"),
    args: [join(desktop, "scripts/electron-test-entry.cjs"), ...args],
    env: {
      ...env,
      LOCUS_DATA_DIR: data.library,
      LOCUS_SERVER_BINARY: binary,
      LOCUS_DESKTOP_HIDDEN: "1",
      LOCUS_TEST_RELAUNCH_LOG: join(output, `session-${++launchNumber}.jsonl`),
      ...extra,
    },
  })
}
async function launch(extra: Record<string, string> = {}) {
  await launchApplication(extra)
  const page = await application!.firstWindow()
  page.setDefaultTimeout(15000)
  return page
}
async function settings(page: Page) {
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await page.getByRole("link", { name: "Setting", exact: true }).click()
  await page.getByRole("button", { name: "Media tools", exact: true }).click()
  await page.waitForFunction(() => !(document.querySelector("#media-ffprobe") as HTMLInputElement)?.disabled)
}
async function close() {
  const closed = application!.waitForEvent("close")
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  application = undefined
}
async function records(path: string): Promise<any[]> {
  try {
    return (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch {
    return []
  }
}
async function replacement(path: string) {
  const until = Date.now() + 30000
  while (Date.now() < until) {
    const events = await records(path)
    if (events.filter((event) => event.event === "host-quit").length >= 2) return events
    await new Promise((done) => setTimeout(done, 50))
  }
  throw new Error("Replacement did not complete its bounded real lifecycle")
}
async function sql(statement: string) {
  await promisify(execFile)(
    "uv",
    [
      "run",
      "python",
      "-c",
      "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(sys.argv[2]); c.commit(); c.close()",
      join(data.library, "metadata.sqlite"),
      statement,
    ],
    { cwd: workspace, windowsHide: true },
  )
}
try {
  // Exercise the real native startup failure and explicit retry surface while a
  // separate owned backend has the same library. No repair page may be loaded.
  const owner = await data.start()
  const before = (await owner.client.GET("/api/v1/external-access/token")).data
  assert(before?.status === "current")
  const conflictLog = join(output, "library-conflict.json"),
    retryGate = join(output, "retry-library")
  let launchError: unknown
  const launching = launchApplication({
    LOCUS_TEST_LIBRARY_CONFLICT_LOG: conflictLog,
    LOCUS_TEST_LIBRARY_RETRY_GATE: retryGate,
  }).catch((error) => {
    launchError = error
  })
  let conflict:
    | { message: string; title: string; buttons: string[]; ready: boolean; ended: boolean }
    | undefined
  for (let count = 0; count < 1000 && !conflict; count++) {
    if (launchError) throw launchError
    try {
      conflict = JSON.parse(await readFile(conflictLog, "utf8"))
    } catch {
      await new Promise((done) => setTimeout(done, 20))
    }
  }
  assert(conflict, "Duplicate startup did not report a native failure")
  assert.match(conflict.message, /library is already open in another Locus backend/)
  assert.equal(conflict.title, "Locus could not start")
  assert.deepEqual(conflict.buttons, ["Retry", "Exit Locus"])
  assert.equal(conflict.ready, false)
  assert.equal(conflict.ended, true)
  const unchanged = (await owner.client.GET("/api/v1/external-access/token")).data
  assert(unchanged?.status === "current" && unchanged.token === before.token)
  await owner.stop()
  await writeFile(retryGate, "retry")
  await launching
  if (launchError) throw launchError
  const duplicatePage = await application!.firstWindow()
  duplicatePage.setDefaultTimeout(15000)
  await duplicatePage.getByRole("grid", { name: "Entities" }).waitFor()
  const afterRetry = await duplicatePage.evaluate(async () =>
    (await fetch("/api/v1/external-access/token")).json(),
  )
  assert(afterRetry.status === "current" && afterRetry.token === before.token)
  const retryChildren = await application!.evaluate(() => (globalThis as any).__desktopTest.children.length)
  assert.equal(retryChildren, 2)
  checks.push(
    "duplicate library startup shows native conflict without readiness; failed child ends before explicit retry; owner exit permits retry with retained Token",
  )
  await close()
  const log = join(output, "restart.jsonl")
  let page = await launch({ LOCUS_TEST_RELAUNCH_LOG: log })
  await settings(page)
  await page.getByLabel("ffprobe", { exact: true }).fill("saved-native-probe")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await page.getByText("Saved · restart required", { exact: true }).waitFor()
  const addressReservation = createServer()
  addressReservation.listen(0, "127.0.0.1")
  await once(addressReservation, "listening")
  const addressInfo = addressReservation.address()
  assert(addressInfo && typeof addressInfo !== "string")
  const savedAddress = `127.0.0.1:${addressInfo.port}`
  await new Promise<void>((resolve) => addressReservation.close(() => resolve()))
  await page.getByRole("button", { name: "External connection", exact: true }).click()
  await page.getByLabel("Saved address", { exact: true }).fill(savedAddress)
  await page.getByRole("button", { name: "Save address", exact: true }).click()
  await page
    .getByRole("region", { name: "External connection", exact: true })
    .getByText("Saved · restart required", { exact: true })
    .waitFor()
  await page.getByRole("button", { name: "Media tools", exact: true }).click()
  await page.getByLabel("ffmpeg", { exact: true }).fill("discard-me")
  await page.getByRole("button", { name: "External connection", exact: true }).click()
  await page.getByLabel("Saved address", { exact: true }).fill("127.0.0.1:1")
  await page.getByRole("button", { name: "Restart application", exact: true }).click()
  await page.getByRole("button", { name: "Discard draft and restart", exact: true }).waitFor()
  const first = await page.evaluate(() => window.locusDesktop!.state())
  assert(first.close.phase === "unconfirmed")
  await page.getByRole("button", { name: "Return to Locus", exact: true }).click()
  await page.getByRole("button", { name: "Media tools", exact: true }).click()
  assert.equal(await page.getByLabel("ffmpeg", { exact: true }).inputValue(), "discard-me")
  await page.getByRole("button", { name: "External connection", exact: true }).click()
  assert.equal(await page.getByLabel("Saved address", { exact: true }).inputValue(), "127.0.0.1:1")
  await page.evaluate(
    (state) =>
      window.locusDesktop!.commitClose({
        attemptId: (state.close as any).attemptId,
        revision: (state.close as any).revision,
        settingsRevision: (state.close as any).settings.revision,
      }),
    first,
  )
  assert.equal((await page.evaluate(() => window.locusDesktop!.state())).close.phase, "idle")
  checks.push("draft return and stale canceled commit")
  await page.getByRole("button", { name: "Restart application", exact: true }).click()
  await page.getByRole("button", { name: "Discard draft and restart", exact: true }).waitFor()
  await page.screenshot({ path: join(output, "discard-confirmation.png") })
  await sql(
    "CREATE TRIGGER settings_fixture_work BEFORE INSERT ON locus_entities BEGIN SELECT (WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) FROM n); END",
  )
  await page.evaluate(() => {
    ;(window as any).__acceptedSettingsFixture = fetch("/api/v1/entities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request_id: crypto.randomUUID() }),
    }).catch(() => undefined)
  })
  for (let attempt = 0; ; attempt++) {
    const status = await page.evaluate(async () => (await fetch("/api/v1/server")).json())
    if (BigInt(status.active_operations) > 0n) break
    assert(attempt < 200, "No accepted work observed")
    await new Promise((done) => setTimeout(done, 10))
  }
  const ended = application!.waitForEvent("close")
  await page.getByRole("button", { name: "Discard draft and restart", exact: true }).click()
  await ended
  application = undefined
  const events = await replacement(log),
    ready = events.filter((event) => event.event === "ready"),
    start = events.find((event) => event.event === "host-start" && event.replacement)
  assert.equal(events.filter((event) => event.event === "relaunch").length, 1)
  assert(
    BigInt(events.find((event) => event.event === "drain").active) > 0n,
    "Restart must drain real accepted SQLite work",
  )
  await sql("DROP TRIGGER settings_fixture_work")
  assert.equal(ready.length, 2)
  assert.notEqual(ready[0].host, ready[1].host)
  assert.notEqual(ready[0].backend, ready[1].backend)
  assert.notEqual(ready[0].run, ready[1].run)
  assert.notEqual(ready[0].credentialDigest, ready[1].credentialDigest)
  assert.equal(ready[0].library, ready[1].library)
  assert.equal(start.previousHostAlive, false)
  assert.equal(start.previousBackendAlive, false)
  assert.equal(ready[1].runtime.runtime.captured.value.ffprobe, "saved-native-probe")
  assert.equal(ready[1].runtime.runtime.captured.value.ffmpeg, "ffmpeg")
  assert.equal(ready[1].externalRuntime.captured.value.address, savedAddress)
  assert.equal(ready[1].externalRuntime.active_address, savedAddress)
  assert(ready[0].externalToken && ready[1].externalToken)
  assert.equal(ready[1].externalToken.context, ready[0].externalToken.context)
  assert.equal(ready[1].externalToken.digest, ready[0].externalToken.digest)
  assert.equal(ready[1].page.hash, "#/entity")
  assert.equal(ready[1].page.settingsFields, 0)
  checks.push(
    "one actual replacement after real accepted-work drain and old host/backend exit; fresh run/credential/session; same library adopted saved values",
  )
  checks.push(
    "both groups' draft consent; saved external address applied after full restart; same retained shared Token and access context",
  )
  // Hold a real committed Settings response. Restart preparation waits; return does not cancel it.
  page = await launch()
  await settings(page)
  await page.addInitScript(() => {
    const original = window.fetch
    window.fetch = async (...args) => {
      const request = new Request(...args)
      const response = await original(request)
      if (request.method === "POST" && new URL(request.url).pathname.includes("/settings/groups/")) {
        await new Promise<void>((done) => {
          ;(window as any).__releaseSettings = done
        })
      }
      return response
    }
  })
  await page.reload()
  await page.getByRole("button", { name: "External connection", exact: true }).click()
  await page.waitForFunction(
    () => !(document.querySelector("#external-address") as HTMLInputElement)?.disabled,
  )
  await page.getByLabel("Saved address", { exact: true }).fill("127.0.0.1:46322")
  await page.getByRole("button", { name: "Save address", exact: true }).click()
  await page.waitForFunction(() => !!(window as any).__releaseSettings)
  await page.getByRole("button", { name: "Restart application", exact: true }).click()
  await page.getByRole("heading", { name: "Preparing to restart" }).waitFor()
  assert.equal((await page.evaluate(() => window.locusDesktop!.state())).close.phase, "preparing")
  await page.getByRole("button", { name: "Return to Locus", exact: true }).click()
  await page.evaluate(() => (window as any).__releaseSettings())
  await page.getByText("Saved · restart required", { exact: true }).waitFor()
  await close()
  checks.push("pending external Settings write defers restart and survives return")
  // A definite Settings failure cannot be bypassed by restart's draft-discard action.
  page = await launch()
  await settings(page)
  await page.addInitScript(() => {
    const original = window.fetch
    window.fetch = async (...args) => {
      const request = new Request(...args)
      if (request.method === "POST" && new URL(request.url).pathname.includes("/settings/groups/"))
        return new Response(
          JSON.stringify({
            status: "failed",
            diagnostic: {
              owner: "settings",
              error: { code: "invalid", message: "Test-owned rejected Settings save" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      return original(request)
    }
  })
  await page.reload()
  await page.getByRole("button", { name: "Media tools", exact: true }).click()
  await page.waitForFunction(() => !(document.querySelector("#media-ffprobe") as HTMLInputElement)?.disabled)
  await page.getByLabel("ffprobe", { exact: true }).fill("failed-draft")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await page.getByRole("button", { name: "Restart application", exact: true }).click()
  await page.getByRole("heading", { name: "Some choices are not confirmed saved" }).waitFor()
  assert.equal(await page.getByRole("button", { name: "Discard draft and restart", exact: true }).count(), 0)
  await page.getByRole("button", { name: "Return to Locus", exact: true }).click()
  await page.getByRole("button", { name: "Discard edits", exact: true }).click()
  await close()
  checks.push("definite Settings failure defers restart until explicit abandonment")

  // Preference preparation still observes failed current intent after leaving the Entity.
  page = await launch()
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await page.addInitScript(() => {
    const original = window.fetch
    window.fetch = async (...args) => {
      const request = new Request(...args)
      if (request.method === "PUT" && new URL(request.url).pathname.endsWith("/view-preference"))
        return new Response(
          JSON.stringify({ code: "invalid_request", message: "Test-owned rejected preference" }),
          { status: 400, headers: { "content-type": "application/json" } },
        )
      return original(request)
    }
  })
  await page.reload()
  await page.getByRole("gridcell").first().dblclick()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  await chooseContentView(page, "File")
  await page.getByRole("link", { name: "Setting", exact: true }).click()
  await page.getByRole("button", { name: "Restart application", exact: true }).click()
  await page.getByRole("heading", { name: "Some choices are not confirmed saved" }).waitFor()
  assert.equal(await page.getByRole("button", { name: "Discard draft and restart", exact: true }).count(), 0)
  await page.getByRole("button", { name: "Return to Locus", exact: true }).click()
  const preferenceClosed = application!.waitForEvent("close")
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await page.getByRole("button", { name: "Continue closing", exact: true }).click()
  await preferenceClosed
  application = undefined
  checks.push("offscreen failed preference defers restart while normal close retains explicit continue-exit")

  // Lost drain acknowledgement cannot claim a live backend or schedule replacement.
  page = await launch({ LOCUS_TEST_DROP_DRAIN_ONCE: "1" })
  await settings(page)
  await page.getByRole("button", { name: "Restart application", exact: true }).click()
  for (let attempt = 0; ; attempt++) {
    if (
      await application!.evaluate(() => (globalThis as any).__desktopTest.children.at(-1).exitCode !== null)
    )
      break
    assert(attempt < 500, "Backend did not finish real drain")
    await new Promise((done) => setTimeout(done, 20))
  }
  assert.equal((await page.evaluate(() => window.locusDesktop!.state())).connection.status, "lost")
  for (let attempt = 0; ; attempt++) {
    if (await application!.evaluate(() => (globalThis as any).__desktopTest.responses.length > 0)) break
    assert(attempt < 200, "Missing native drain-failure dialog")
    await new Promise((done) => setTimeout(done, 20))
  }
  const lostClosed = application!.waitForEvent("close")
  await application!.evaluate(() => (globalThis as any).__desktopTest.responses.shift()(0))
  await lostClosed
  application = undefined
  checks.push("lost drain response invalidates backend attribution without relaunch")
  await sql(
    "UPDATE locus_settings_values SET payload='{}' WHERE group_id='25c3fd2a-4148-4cb3-aca4-47c3ce3402e5'",
  )
  const repairLog = join(output, "repair-restart.jsonl")
  page = await launch({ LOCUS_TEST_RELAUNCH_LOG: repairLog })
  await page.getByText("Library needs attention", { exact: true }).waitFor()
  assert.equal(await page.getByLabel("ffprobe", { exact: true }).inputValue(), "")
  const selection = await page.evaluate(() => window.locusDesktop!.selectImportFiles())
  assert.equal(selection.status, "failed")
  await page.getByRole("button", { name: "Reset to defaults", exact: true }).click()
  await page.getByRole("button", { name: "Confirm reset", exact: true }).click()
  await page.waitForFunction(
    () => (document.querySelector("#media-ffprobe") as HTMLInputElement).value === "ffprobe",
  )
  assert.equal(
    (await page.evaluate(async () => (await fetch("/api/v1/server")).json())).availability.status,
    "restricted",
  )
  const repairEnded = application!.waitForEvent("close")
  await page.getByRole("button", { name: "Retry application", exact: true }).click()
  await repairEnded
  application = undefined
  const repairEvents = await replacement(repairLog)
  assert.equal(repairEvents.filter((event) => event.event === "ready").at(-1).availability.status, "normal")
  checks.push("restricted repair saves without business start; explicit retry produces normal replacement")
  await sql(
    "UPDATE locus_settings_values SET revision='invalid' WHERE group_id='25c3fd2a-4148-4cb3-aca4-47c3ce3402e5'",
  )
  page = await launch()
  await page.getByText("Library needs attention", { exact: true }).waitFor()
  assert.equal(await page.getByRole("button", { name: "Reset to defaults", exact: true }).isDisabled(), true)
  await close()
  checks.push("invalid revision disables reset")
  // Failed minimal bootstrap has no renderer to attach to. Run the same hidden host
  // with explicit test-owned native dialog answers and bounded process completion.
  const retryLog = join(output, "startup-retry.jsonl")
  await promisify(execFile)(require("electron"), [join(desktop, "scripts/electron-test-entry.cjs")], {
    windowsHide: true,
    timeout: 30000,
    env: {
      ...env,
      LOCUS_DATA_DIR: data.library,
      LOCUS_DESKTOP_HIDDEN: "1",
      LOCUS_SERVER_BINARY: join(data.root, "missing-server"),
      LOCUS_TEST_RETRY_BINARY: binary,
      LOCUS_TEST_RELAUNCH_LOG: retryLog,
      LOCUS_TEST_CLOSE_READY: "1",
    },
  })
  const retryEvents = await records(retryLog)
  assert.equal(retryEvents.filter((event) => event.event === "ready").length, 1)
  assert.equal(retryEvents.filter((event) => event.event === "backend-exit").at(-1).code, 0)
  checks.push("missing binary retry explicitly starts one fresh owned backend")
  const missing = join(data.root, "missing-intended-library"),
    missingLog = join(output, "missing-library-dialog.json")
  await promisify(execFile)(
    require("electron"),
    [
      join(desktop, "scripts/electron-test-entry.cjs"),
      `--locus-library-root=${missing}`,
      "--locus-require-existing",
    ],
    {
      windowsHide: true,
      timeout: 30000,
      env: {
        ...env,
        LOCUS_DATA_DIR: data.library,
        LOCUS_DESKTOP_HIDDEN: "1",
        LOCUS_SERVER_BINARY: binary,
        LOCUS_TEST_DIALOG_RESPONSE: "1",
        LOCUS_TEST_DIALOG_LOG: missingLog,
      },
    },
  )
  const missingDialog = JSON.parse(await readFile(missingLog, "utf8"))
  assert.deepEqual(missingDialog.options.buttons, ["Retry", "Exit Locus"])
  assert.equal(missingDialog.childCount, 1)
  await assert.rejects(access(join(missing, "metadata.sqlite")))
  checks.push("missing intended library is not recreated; failed bootstrap child ends before native exit")
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: true, checks }, null, 2))
  console.log(JSON.stringify({ passed: true, output, checks }))
} finally {
  if (application) {
    await application
      .evaluate(() => {
        for (const child of (globalThis as any).__desktopTest.children)
          if (child.exitCode === null) child.kill()
      })
      .catch(() => {})
    await application.evaluate(({ app }) => app.exit()).catch(() => {})
  }
  await data.dispose()
}

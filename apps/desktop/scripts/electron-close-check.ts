import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { once } from "node:events"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { promisify } from "node:util"
import { join } from "node:path"
import { _electron as electron, type ElectronApplication, type Page } from "playwright"
import { fixture, desktop, binary, workspace, outputDirectory } from "./fixture.ts"

const require = createRequire(import.meta.url)
const data = await fixture(),
  output = await outputDirectory("native-close")
const checks: string[] = []
let application: ElectronApplication | undefined
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
)
delete env.ELECTRON_RUN_AS_NODE
async function launch(overrides: Record<string, string> = {}) {
  application = await electron.launch({
    executablePath: require("electron"),
    args: [join(desktop, "scripts/electron-test-entry.cjs")],
    env: { ...env, LOCUS_DATA_DIR: data.library, LOCUS_SERVER_BINARY: binary, LOCUS_DESKTOP_HIDDEN: "1", ...overrides },
  })
  const page = await application.firstWindow()
  page.setDefaultTimeout(15_000)
  return page
}
async function openImage(page: Page) {
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await page.getByRole("gridcell").first().dblclick()
  await page.locator('[data-slot="entity-inspection"]').waitFor()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  return (await page.locator('[data-slot="entity-inspection"]').getAttribute("data-entity-id"))!
}
async function nativeClose() {
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
}
async function finishByClose() {
  const closed = application!.waitForEvent("close")
  await nativeClose()
  await closed
  application = undefined
}
async function waitNativeDialog() {
  for (let attempts = 0; attempts < 100; attempts++) {
    if (await application!.evaluate(() => (globalThis as any).__desktopTest.responses.length > 0)) return
    await new Promise((done) => setTimeout(done, 20))
  }
  throw new Error("Expected a test-intercepted native dialog")
}
async function nativeChoice(index: number, closes = false) {
  await waitNativeDialog()
  const closed = closes ? application!.waitForEvent("close") : undefined
  await application!.evaluate((_electron, choice) => (globalThis as any).__desktopTest.responses.shift()(choice), index)
  if (closed) {
    await closed
    application = undefined
  }
}
async function delayNextEntity() {
  // Bounded real SQLite work inside the accepted transaction, confined to this
  // synthetic fixture. A foreign lock would hit Store's 2-second busy timeout
  // and could finish before the native UI handoff was observed.
  const code =
    "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('CREATE TRIGGER desktop_fixture_work BEFORE INSERT ON locus_entities BEGIN SELECT (WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT sum(x) FROM n); END'); c.commit(); c.close()"
  await promisify(execFile)("uv", ["run", "python", "-c", code, join(data.library, "metadata.sqlite")], {
    cwd: workspace,
    windowsHide: true,
  })
}
async function status(page: Page) {
  return page.evaluate(async () => (await fetch("/api/v1/server")).json())
}
async function nativeStatus() {
  return application!.evaluate(async () => {
    const fixture = (globalThis as any).__desktopTest
    return (
      await fetch(`${fixture.ready.origin}/api/v1/server`, {
        headers: { Authorization: `Bearer ${fixture.bootstrap.credential}`, "X-Locus-Run": fixture.ready.run_id },
      })
    ).json()
  })
}
async function acceptWork(page: Page) {
  await page.evaluate(() => {
    ;(window as any).__accepted = fetch("/api/v1/entities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request_id: crypto.randomUUID() }),
    })
      .then((response) => response.json())
      .catch(() => undefined)
  })
  for (let attempt = 0; BigInt((await nativeStatus()).active_operations) === 0n; attempt++) {
    assert(attempt < 100)
    await new Promise((done) => setTimeout(done, 10))
  }
}

try {
  // A real committed save with its renderer response held. Returning does not cancel it, a duplicate
  // native close does not start another attempt, and a stale prepared reply has
  // no authority after the user returned.
  let page = await launch()
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await page.addInitScript(() => {
    const original = window.fetch
    window.fetch = async (...args) => {
      const request = new Request(...args)
      const response = await original(request)
      if (
        request.method === "PUT" &&
        new URL(request.url).pathname.endsWith("/view-preference") &&
        !(window as any).__heldOnce
      ) {
        ;(window as any).__heldOnce = true
        await new Promise<void>((release) => {
          ;(window as any).__releaseSave = release
        })
      }
      return response
    }
  })
  await page.reload()
  const heldEntity = await openImage(page)
  await page.getByRole("button", { name: "Use File view", exact: true }).click()
  await page.getByText("Saving choice…", { exact: true }).waitFor()
  await page.waitForFunction(() => !!(window as any).__releaseSave)
  await nativeClose()
  await page.getByRole("dialog").waitFor()
  const attempt = await page.evaluate(async () => (await window.locusDesktop!.state()).close)
  assert.equal(attempt.phase, "preparing")
  await nativeClose()
  assert.deepEqual(await page.evaluate(async () => (await window.locusDesktop!.state()).close), attempt)
  await page.getByRole("button", { name: "Return to Locus", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "detached" })
  assert.equal((await status(page)).admission, "open")
  await page.evaluate(
    async (attemptId) => window.locusDesktop!.prepared({ attemptId, revision: 0, items: [] }),
    attempt.attemptId
  )
  assert.equal((await page.evaluate(() => window.locusDesktop!.state())).close.phase, "idle")
  await page.evaluate(() => (window as any).__releaseSave())
  await page.getByText("Choice saved", { exact: true }).waitFor()
  await finishByClose()
  checks.push("Held actual save, duplicate close, return preserves admission/accepted save, stale reply ignored")

  // A definite failed current save is listed. Escape dismisses only the dialog;
  // the underlying inspection remains the same. Retry after return still saves.
  page = await launch()
  const entity = await openImage(page)
  let reject = true
  await page.route("**/api/v1/entities/*/view-preference", async (route) =>
    reject && route.request().method() === "PUT"
      ? route.fulfill({
          status: 200,
          json: { status: "failed", diagnostic: { owner: "executor", message: "Isolated definite save failure" } },
        })
      : route.continue()
  )
  await page.getByRole("button", { name: "Use Image view", exact: true }).click()
  await page.getByText("Choice not saved", { exact: true }).waitFor()
  await nativeClose()
  await page.getByText("Some choices are not confirmed saved", { exact: true }).waitFor()
  const url = page.url()
  let events = 0
  await page.exposeFunction("closeObserved", () => {
    events++
  })
  await page.evaluate(() => window.locusDesktop!.observe(() => (window as any).closeObserved()))
  await page.screenshot({ path: join(output, "failed-close.png") })
  await page.waitForTimeout(100)
  assert(events < 5, "no unchanged preparation IPC loop")
  await page.keyboard.press("Escape")
  await page.getByRole("dialog").waitFor({ state: "detached" })
  assert.equal(page.url(), url)
  assert.equal((await status(page)).admission, "open")
  reject = false
  await page.getByRole("button", { name: "Retry saving", exact: true }).click()
  await page.getByText("Choice saved", { exact: true }).waitFor()
  await finishByClose()
  checks.push("Failed save attributable close, no IPC loop, Escape returns without exiting viewer, later retry saves")

  // Terminal uncertainty remains unconfirmed until an actual preference read.
  page = await launch()
  await openImage(page)
  await page.route("**/api/v1/entities/*/view-preference", async (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 200,
          json: {
            status: "failed",
            diagnostic: {
              owner: "preferences",
              error: {
                code: "store",
                diagnostic: { kind: "commit_outcome_unknown", message: "Isolated commit uncertainty" },
              },
            },
          },
        })
      : route.continue()
  )
  await page.getByRole("button", { name: "Use File view", exact: true }).click()
  await page.getByText("Saving not confirmed", { exact: true }).waitFor()
  await nativeClose()
  await page.getByText("Some choices are not confirmed saved", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Return to Locus", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "detached" })
  assert.equal((await status(page)).admission, "open")
  await page.getByRole("button", { name: "Check saving", exact: true }).click()
  await page.getByText("Choice not saved", { exact: true }).waitFor()
  // Admit an independent actual operation, then continue exit with an unconfirmed
  // choice. Drain must keep the window until that accepted DB work completes.
  await delayNextEntity()
  await page.evaluate(() => {
    ;(window as any).__accepted = fetch("/api/v1/entities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request_id: crypto.randomUUID() }),
    }).then((response) => response.json())
  })
  for (let attempt = 0; BigInt((await nativeStatus()).active_operations) === 0n; attempt++) {
    assert(attempt < 100)
    await new Promise((done) => setTimeout(done, 10))
  }
  await nativeClose()
  await page.getByText("Some choices are not confirmed saved", { exact: true }).waitFor()
  const closed = application!.waitForEvent("close")
  await page.getByRole("button", { name: "Continue closing", exact: true }).click()
  await page.getByText("Finishing accepted work", { exact: true }).waitFor()
  assert.equal((await nativeStatus()).admission, "draining")
  assert.equal(await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
  await closed
  application = undefined
  checks.push("Uncertain preference return/check and explicit continued exit wait for actual accepted-work drain")

  page = await launch()
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await acceptWork(page)
  await nativeClose()
  await page.getByText("Finishing accepted work", { exact: true }).waitFor()
  await application!.evaluate(() => (globalThis as any).__desktopTest.children[0].kill())
  await waitNativeDialog()
  assert.deepEqual(await application!.evaluate(() => (globalThis as any).__desktopTest.dialogs.at(-1).buttons), [
    "Close Locus",
  ])
  assert.equal((await page.evaluate(() => window.locusDesktop!.state())).close.phase, "draining")
  assert.equal(
    await page.evaluate(async () => {
      try {
        await fetch("/api/v1/server")
        return false
      } catch {
        return true
      }
    }),
    true
  )
  await nativeChoice(0, true)
  checks.push("Backend loss during drain revokes grants and never returns to ordinary admission")

  page = await launch()
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await acceptWork(page)
  await nativeClose()
  await page.getByText("Finishing accepted work", { exact: true }).waitFor()
  const crashedDrain = application!.waitForEvent("close")
  await application!.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer()
  )
  await waitNativeDialog()
  assert.deepEqual(await application!.evaluate(() => (globalThis as any).__desktopTest.dialogs.at(-1).buttons), [
    "Keep waiting",
    "Check closing",
  ])
  assert.equal(
    await application!.evaluate(() => (globalThis as any).__desktopTest.states.at(-1).close.phase),
    "draining"
  )
  await nativeChoice(0)
  await crashedDrain
  application = undefined
  checks.push("Renderer crash during committed drain preserves irreversible state until healthy backend completion")

  page = await launch({ LOCUS_TEST_DROP_DRAIN_ONCE: "1" })
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await acceptWork(page)
  await nativeClose()
  await waitNativeDialog()
  assert.deepEqual(await application!.evaluate(() => (globalThis as any).__desktopTest.dialogs.at(-1).buttons), [
    "Keep waiting",
    "Check closing",
  ])
  const committed = (await page.evaluate(() => window.locusDesktop!.state())).close
  assert.equal(committed.phase, "draining")
  await page.evaluate(
    (attemptId) => window.locusDesktop!.closeAction({ attemptId, action: "return" }),
    committed.attemptId
  )
  assert.equal((await page.evaluate(() => window.locusDesktop!.state())).close.phase, "draining")
  const recoveredDrain = application!.waitForEvent("close")
  await nativeChoice(1)
  // Resolving the native dialog dispatches the retry; its HTTP response is a
  // later observation. Wait for that actual response, without retrying the test
  // action or treating absence of evidence as a successful drain.
  const retried = await application!.evaluate(async () => {
    const fixture = (globalThis as any).__desktopTest
    const deadline = Date.now() + 5_000
    while (fixture.drainRequests < 2) {
      if (Date.now() >= deadline) throw new Error("The explicit drain retry did not produce a response")
      await new Promise((done) => setTimeout(done, 10))
    }
    return {
      count: fixture.drainRequests,
      deliveries: fixture.drainDeliveries,
      phase: fixture.states.at(-1).close.phase,
    }
  })
  assert.equal(retried.count, 2)
  assert.deepEqual(retried.deliveries[1], retried.deliveries[0])
  assert.equal(retried.phase, "draining")
  await recoveredDrain
  application = undefined
  checks.push("Applied drain with lost response remains sealed; explicit identical drain recovery completes")

  // Renderer loss uses the native fallback without orphaning its healthy backend.
  page = await launch()
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await application!.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer()
  )
  await nativeChoice(0)
  await nativeClose()
  await nativeChoice(1, true)
  checks.push("Renderer loss cannot claim readiness; native return/continue drains owned backend")

  // Every unexpected backend exit revokes the grant and requires manual restart.
  page = await launch()
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await application!.evaluate(() => (globalThis as any).__desktopTest.children[0].kill())
  await page.getByText("Backend unavailable", { exact: true }).waitFor()
  const failed = await page.evaluate(async () => {
    try {
      await fetch("/api/v1/server")
      return false
    } catch {
      return true
    }
  })
  assert(failed)
  assert.equal(await application!.evaluate(() => (globalThis as any).__desktopTest.children.length), 1)
  await nativeClose()
  await nativeChoice(1, true)
  checks.push("Backend loss revokes grant, reports loss, does not restart/replay, and allows truthful close")

  // A loaded HTML page is not a preparation consumer acknowledgment.
  const blank = join(data.root, "no-consumer")
  await mkdir(blank)
  await writeFile(join(blank, "index.html"), "<!doctype html><title>No consumer fixture</title>")
  page = await launch({ LOCUS_RENDERER_ROOT: blank })
  await page.waitForURL(/127\.0\.0\.1/)
  await nativeClose()
  await nativeChoice(0)
  await nativeClose()
  await nativeChoice(1, true)
  checks.push("Loaded page without preparation consumer cannot count as ready; continued native exit drains")

  const startupLog = join(output, "startup-failure.json")
  const startup = spawn(require("electron"), [join(desktop, "scripts/electron-test-entry.cjs")], {
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...env,
      LOCUS_DATA_DIR: data.library,
      LOCUS_SERVER_BINARY: join(data.root, "missing-server"),
      LOCUS_DESKTOP_HIDDEN: "1",
      LOCUS_TEST_DIALOG_RESPONSE: "1",
      LOCUS_TEST_DIALOG_LOG: startupLog,
    },
  })
  const [code] = await once(startup, "exit", { signal: AbortSignal.timeout(15_000) })
  assert.equal(code, 0)
  const startupResult = JSON.parse(await readFile(startupLog, "utf8"))
  assert.equal(startupResult.childCount, 0)
  assert.match(startupResult.options.message, /backend is missing/)
  checks.push("Missing startup artifact reports native failure without a backend orphan")
  const server = await data.start()
  const persisted = await server.client.GET("/api/v1/entities/{entity_id}/view-preference", {
    params: { path: { entity_id: entity } },
  })
  assert.equal(persisted.data?.status, "saved")
  if (persisted.data?.status === "saved") assert.equal(persisted.data.view_definition_id, "image.inspect")
  await server.stop()
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ passed: true, checks, heldEntity, persisted: persisted.data }, null, 2)
  )
  console.log(`PASS ${checks.length} hidden Electron lifecycle scenarios. Evidence: ${output}`)
} catch (error) {
  if (application) {
    const pages = application.windows()
    if (pages[0] && !pages[0].isClosed()) {
      await pages[0].screenshot({ path: join(output, "failure.png") }).catch(() => {})
      await writeFile(
        join(output, "failure.txt"),
        await pages[0]
          .locator("body")
          .innerText()
          .catch(() => "Renderer unavailable")
      )
    }
  }
  throw error
} finally {
  if (application)
    await application
      .evaluate(({ app }) => {
        for (const child of (globalThis as any).__desktopTest.children) if (child.exitCode === null) child.kill()
        app.exit(1)
      })
      .catch(() => {})
  await data.dispose()
}

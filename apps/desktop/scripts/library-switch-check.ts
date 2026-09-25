import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { access, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { _electron as electron, type ElectronApplication } from "playwright"
import { displayLibraryPath } from "../src/main/library-location.ts"
import { fixture, desktop, workspace, outputDirectory } from "./fixture.ts"

const a = await fixture(2),
  b = await fixture(1)
const output = await outputDirectory("library-switch")
const log = join(output, "switch.jsonl")
const local = join(a.root, "application-data")
const home = join(a.root, "home")
const locator =
  process.platform === "darwin"
    ? join(home, "Library", "Application Support", "Locus", "path")
    : join(local, "Locus", "path")
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
)
delete env.ELECTRON_RUN_AS_NODE
Object.assign(env, {
  LOCUS_DATA_DIR: a.library,
  LOCUS_SERVER_BINARY: join(
    workspace,
    "target/debug",
    process.platform === "win32" ? "locus-server.exe" : "locus-server",
  ),
  LOCUS_DESKTOP_HIDDEN: "1",
  LOCUS_TEST_RELAUNCH_LOG: log,
  LOCALAPPDATA: local,
  XDG_DATA_HOME: local,
  HOME: home,
})
const require = createRequire(import.meta.url)
let application: ElectronApplication | undefined
async function launch() {
  application = await electron.launch({
    executablePath: require("electron"),
    args: [join(desktop, "scripts/electron-test-entry.cjs")],
    env,
  })
  const page = await application.firstWindow()
  page.setDefaultTimeout(15_000)
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  return page
}
try {
  let page = await launch()
  await page.getByRole("button", { name: "Setting", exact: true }).click()
  await page.getByRole("button", { name: "Library", exact: true }).click()
  await page.getByText(a.library, { exact: true }).waitFor()
  await page.getByText("ENV · LOCUS_DATA_DIR", { exact: true }).waitFor()
  const choose = () => page.getByRole("button", { name: "Choose library and restart", exact: true }).click()
  const select = (path: string) =>
    application!.evaluate((_electron, path) => {
      ;(globalThis as any).__desktopTest.fileSelections.push({ canceled: false, filePaths: [path] })
    }, path)
  await choose() // Picker cancel.
  await page.getByRole("button", { name: "Choose library and restart", exact: true }).waitFor()
  await select(a.root) // No metadata database: preserve the current session.
  await choose()
  await page.getByText("Choose an existing Locus library folder containing metadata.sqlite.").waitFor()
  assert.equal((await page.evaluate(() => window.locusDesktop!.state())).close.phase, "idle")
  await select(a.library)
  await choose()
  await page.getByText("This library is already open.").waitFor()
  await assert.rejects(access(locator))
  await page.getByRole("button", { name: "Media tools", exact: true }).click()
  await page.getByLabel("ffprobe", { exact: true }).fill("unsaved-tool")
  await page.getByRole("button", { name: "Library", exact: true }).click()
  await select(b.library)
  await choose()
  await page.getByRole("button", { name: "Discard draft and switch", exact: true }).waitFor()
  assert.equal((await page.evaluate(() => window.locusDesktop!.state())).library?.switchTarget, b.library)
  await page.getByRole("button", { name: "Return to Locus", exact: true }).click()
  await page.getByRole("button", { name: "Media tools", exact: true }).click()
  assert.equal(await page.getByLabel("ffprobe", { exact: true }).inputValue(), "unsaved-tool")
  const returned = await page.evaluate(() => window.locusDesktop!.state())
  assert.equal(returned.library?.root, a.library)
  assert.equal(returned.library?.switchTarget, undefined)
  await assert.rejects(access(locator))
  await page.getByRole("button", { name: "Discard edits", exact: true }).click()
  await page.getByRole("button", { name: "Library", exact: true }).click()
  await select(b.library)
  const closed = application!.waitForEvent("close")
  await choose()
  await closed
  application = undefined
  let events: any[] = []
  const until = Date.now() + 30_000
  while (Date.now() < until) {
    events = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    if (events.filter((e) => e.event === "host-quit").length >= 2) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const ready = events.filter((e) => e.event === "ready")
  assert.equal(ready.length, 2)
  assert.equal(displayLibraryPath(ready[0].library), a.library)
  assert.equal(displayLibraryPath(ready[1].library), b.library)
  assert.notEqual(ready[0].run, ready[1].run)
  assert.equal(events.find((e) => e.event === "host-start" && e.replacement).previousBackendAlive, false)
  assert.equal((await readFile(locator, "utf8")).trim(), b.library)
  // Reopen the persisted locator in isolation; never consult the user's real OS application-data directory.
  env.LOCUS_DATA_DIR = (await readFile(locator, "utf8")).trim()
  delete env.LOCUS_TEST_RELAUNCH_LOG
  page = await launch()
  assert.equal((await page.evaluate(() => window.locusDesktop!.state())).library?.root, b.library)
  const finished = application!.waitForEvent("close")
  await page.evaluate(() => window.locusDesktop!.requestLifecycle("close"))
  await finished
  application = undefined
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "picker cancel",
          "invalid folder",
          "same library",
          "draft confirmation and cancel",
          "real restart into second library",
          "old backend ended",
          "persisted default points to a reopenable library",
        ],
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ passed: true, output }))
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
  await a.dispose()
  await b.dispose()
}

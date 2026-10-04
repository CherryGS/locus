import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { _electron as electron } from "playwright"
import { fixturePng } from "../../../packages/locus-client/smoke-png.ts"
import { binary, desktop, workspace } from "./fixture.ts"

// Use the production host/preload and real OS picker. Only provider acquisition
// is supplied by the fixture server; task states come from actual execution.
const hidden = process.argv.includes("--hidden")
await mkdir(join(workspace, ".local"), { recursive: true })
const root = await mkdtemp(join(workspace, ".local", "native-import-preview-"))
const library = join(root, "library")
const photo = join(root, "sample-image.png"), text = join(root, "sample-notes.txt")
const missing = join(root, "missing-source.txt")
await writeFile(photo, fixturePng(640, 360))
await writeFile(text, "Isolated native import review.\n")
const generated = await promisify(execFile)("just", ["server-civitai-inputs", root], {
  cwd: workspace, windowsHide: true, timeout: 120000,
})
const seed = JSON.parse(generated.stdout) as { config: string; cases: { name: string; path: string }[] }
const env = Object.fromEntries(Object.entries(process.env).filter((value): value is [string, string] => typeof value[1] === "string"))
delete env.ELECTRON_RUN_AS_NODE
let application: Awaited<ReturnType<typeof electron.launch>> | undefined
try {
  application = await electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [join(desktop, "out/main/index.js"), "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
    env: { ...env, LOCUS_DATA_DIR: library, LOCUS_SERVER_BINARY: binary,
      LOCUS_CIVITAI_FIXTURE: seed.config, LOCUS_FIXTURE_EXTERNAL_EPHEMERAL: "1",
      LOCUS_FIXTURE_LOOKUP_DELAY_MS: hidden ? "10000" : "60000", LOCUS_DESKTOP_HIDDEN: "1" },
  })
  const page = await application.firstWindow()
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false))
  page.setDefaultTimeout(15000)
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.getByRole("button", { name: "Locus", exact: true }).waitFor()
  const submit = async (paths: string[]) => {
    const receipt = await page.evaluate(async body => {
      const response = await fetch("/api/v1/import-batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!response.ok) throw Error(`Sample import rejected: ${response.status}`)
      return response.json()
    }, { request_id: randomUUID(), source_paths: paths }) as { task_id: string }
    return receipt.task_id
  }
  const terminal = async (id: string) => {
    await page.waitForFunction(async taskId => {
      const response = await fetch(`/api/v1/tasks/${taskId}/outcome`)
      return response.ok && (await response.json()).status === "complete"
    }, id, { timeout: 120000 })
  }
  await terminal(await submit([photo, text]))
  await terminal(await submit([missing]))
  const processing = await submit([seed.cases.find(item => item.name === "A")!.path])
  await page.getByRole("button", { name: /Tasks.*3 records.*1 active/ }).waitFor()
  await page.getByRole("button", { name: "Refresh library", exact: true }).click()
  await page.getByRole("button", { name: /^Tasks/ }).click()
  const records = page.locator("[data-task-record]")
  await records.filter({ has: page.getByRole("img", { name: "Active", exact: true }) }).click()
  await page.getByRole("button", { name: "Check results", exact: true }).click()
  const capture = async (name: string) => {
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const png = await application!.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })
      return image.toPNG().toString("base64")
    })
    await writeFile(join(root, name), Buffer.from(png, "base64"))
  }
  assert(await records.filter({ has: page.getByRole("img", { name: "Active", exact: true }) }).isVisible(), "Preview must contain actual active execution")
  assert.deepEqual(errors, [])
  if (hidden) {
    await terminal(processing)
    await records.filter({ has: page.getByRole("img", { name: "Active", exact: true }) }).waitFor({ state: "hidden" })
    await page.getByRole("textbox", { name: "Search tasks", exact: true }).fill("missing-source.txt")
    await records.first().click()
    await page.getByRole("button", { name: "Recopy source and import", exact: true }).waitFor()
    const closed = application.waitForEvent("close")
    await page.evaluate(() => window.locusDesktop!.requestLifecycle("close"))
    await closed
    application = undefined
    console.log(JSON.stringify({ passed: true, root, library, productionPicker: true }))
  } else {
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setTitle("Locus · Isolated Import / Tasks preview")
      window.show()
    })
    await capture("processing.png")
    await writeFile(join(root, "README.md"), `# Native Import / Tasks preview\n\nLibrary: ${library}\n\nThis window uses a fresh isolated library and the production file picker. Tasks contains successful and failed imports plus a real model import delayed for 60 seconds at provider lookup. Close Tasks and click Import to choose your own sample files.\n`)
    console.log(JSON.stringify({ root, library, visible: true, processing: "Provider lookup delayed for 60 seconds", nativePicker: "Close Tasks, then click Import" }))
    await application.waitForEvent("close", { timeout: 0 })
    application = undefined
  }
} finally {
  if (application) await application.close().catch(() => {})
}

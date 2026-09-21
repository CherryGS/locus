import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join } from "node:path"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { _electron as electron } from "playwright"
import { fixture, desktop, binary, outputDirectory } from "./fixture.ts"
const require = createRequire(import.meta.url),
  data = await fixture(),
  output = await outputDirectory("import-native")
const sources = await mkdtemp(join(tmpdir(), "locus-import-native-")),
  source = join(sources, "native-input.txt")
await writeFile(source, "selected through the native bridge")
let application: Awaited<ReturnType<typeof electron.launch>> | undefined
try {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  )
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({
    executablePath: require("electron"),
    args: [join(desktop, "scripts/electron-test-entry.cjs")],
    env: { ...env, LOCUS_DATA_DIR: data.library, LOCUS_SERVER_BINARY: binary, LOCUS_DESKTOP_HIDDEN: "1" },
  })
  const page = await application.firstWindow()
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  assert.equal(
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    false,
  )
  assert.deepEqual(await page.evaluate(() => window.locusDesktop!.selectImportFiles()), {
    status: "canceled",
  })
  await application.evaluate((_electron, source) => {
    ;(globalThis as any).__desktopTest.fileSelections.push({ canceled: false, filePaths: [source] })
  }, source)
  await page.getByRole("button", { name: "Import", exact: true }).click()
  assert.equal(await page.getByRole("dialog", { name: "Tasks this run" }).isVisible(), false)
  await page.getByRole("button", { name: /^Tasks/ }).click()
  await page.locator("[data-task-record] > summary").filter({ hasText: "1 complete" }).waitFor()
  const options = await application.evaluate(() => (globalThis as any).__desktopTest.fileDialogs)
  assert.deepEqual(options[0].properties, ["openFile", "multiSelections"])
  assert.equal(options[0].buttonLabel, "Import")
  // Exercise the actual registered IPC handler with an untrusted frame sender.
  const refused = await application.evaluate(async ({ ipcMain, BrowserWindow }) => {
    const handler = (ipcMain as any)._invokeHandlers.get("locus:select-import-files")
    const window = BrowserWindow.getAllWindows()[0]
    try {
      await handler({ sender: window.webContents, senderFrame: {} })
      return false
    } catch {
      return true
    }
  })
  assert(refused)
  const closed = application.waitForEvent("close")
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  application = undefined
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        sources,
        options,
        unauthorizedFrameRejected: refused,
        note: "Production preload/main IPC and hidden Electron lifecycle; dialog result supplied by test, no OS picker interaction",
      },
      null,
      2,
    ),
  )
  console.log(
    `PASS production native selection bridge, explicit cancel, trusted-frame guard and normal close/drain. ${output}`,
  )
} finally {
  if (application)
    await application
      .evaluate(({ app }) => {
        for (const child of (globalThis as any).__desktopTest.children)
          if (child.exitCode === null) child.kill()
        app.exit(1)
      })
      .catch(() => {})
  await data.dispose()
}

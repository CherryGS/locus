import { waitForContentViewSaved, chooseContentView } from "./content-view-choice.ts"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { _electron as electron } from "playwright"
import { fixture, desktop, binary, outputDirectory } from "./fixture.ts"

const require = createRequire(import.meta.url)
const data = await fixture()
const output = await outputDirectory("electron")
let application: Awaited<ReturnType<typeof electron.launch>> | undefined
try {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  )
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({
    executablePath: require("electron"),
    args: [join(desktop, "scripts/electron-test-entry.cjs")],
    env: { ...env, LOCUS_DATA_DIR: data.library, LOCUS_SERVER_BINARY: binary, LOCUS_DESKTOP_HIDDEN: "1" },
  })
  const page = await application.firstWindow()
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false)
  assert.equal(await page.evaluate(() => typeof window.locusDesktop?.ready), "function")
  await page.getByRole("gridcell").first().dblclick()
  await page.locator('[data-slot="entity-inspection"]').waitFor()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  await chooseContentView(page, "File")
  await waitForContentViewSaved(page)
  const entity = await page.locator('[data-slot="entity-inspection"]').getAttribute("data-entity-id")
  await page.screenshot({ path: join(output, "connected-file.png") })
  assert.deepEqual(errors, [])
  const closed = application.waitForEvent("close")
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  application = undefined
  const backend = await data.start()
  const preference = await backend.client.GET("/api/v1/entities/{entity_id}/view-preference", {
    params: { path: { entity_id: entity! } },
  })
  assert.equal(preference.data?.status, "saved")
  if (preference.data?.status === "saved") assert.equal(preference.data.view_definition_id, "file.info")
  await backend.stop()
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ passed: true, entity, preference: preference.data, errors, library: data.library }, null, 2)
  )
  console.log(
    `PASS hidden production Electron preload, authorization, save, native close/drain and restart. Evidence: ${output}`
  )
} finally {
  if (application) {
    await application
      .evaluate(({ app }) => {
        for (const child of (globalThis as any).__desktopTest.children) if (child.exitCode === null) child.kill()
        app.exit(1)
      })
      .catch(() => {})
  }
  await data.dispose()
}

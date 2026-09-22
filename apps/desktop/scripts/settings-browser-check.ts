import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { chromium } from "playwright"
import { fixture, outputDirectory, workspace } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"
const output = await outputDirectory("settings-browser")
process.env.LOCUS_FFPROBE = "explicit-environment-probe"
const data = await fixture()
let backend = await data.start(),
  preview = await browserPreview(backend)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.setDefaultTimeout(15_000)
const errors: string[] = []
page.on("pageerror", (error) => errors.push(error.message))
let releaseRuntime: () => void = () => {}
const runtimeResponse = new Promise<void>((resolve) => { releaseRuntime = resolve })
try {
  await page.route("**/api/v1/settings/media-runtime", async (route) => {
    await runtimeResponse
    await route.continue().catch(() => {})
  })
  await page.goto(`${preview.origin}/#/setting`)
  await page.getByLabel("ffprobe", { exact: true }).waitFor()
  await page.waitForFunction(() => !(document.querySelector("#media-ffprobe") as HTMLInputElement)?.disabled)
  assert.equal(await page.getByLabel("ffprobe", { exact: true }).inputValue(), "ffprobe")
  assert.equal(await page.getByText("Saved · restart required", { exact: true }).count(), 0)
  assert.equal(await page.getByText("Media did not start; active tool paths are unavailable.", { exact: true }).count(), 0)
  await page.getByText("Reading the current runtime configuration…", { exact: true }).waitFor()
  releaseRuntime()
  await page.locator("dd").filter({ hasText: "explicit-environment-probe" }).waitFor()
  await page.unroute("**/api/v1/settings/media-runtime")
  await page.getByLabel("ffprobe", { exact: true }).fill("saved-probe")
  await page.getByRole("link", { name: "Entity", exact: true }).click()
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await page.getByRole("link", { name: "Setting", exact: true }).click()
  assert.equal(await page.getByLabel("ffprobe", { exact: true }).inputValue(), "saved-probe")
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await page.getByText("Saved · restart required", { exact: true }).waitFor()
  await page.locator("dd").filter({ hasText: "explicit-environment-probe" }).waitFor()
  await page.screenshot({ path: join(output, "normal.png"), fullPage: true })
  await page.getByLabel("ffmpeg", { exact: true }).fill("")
  await page.getByText("Enter an executable name or path.", { exact: true }).waitFor()
  assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isDisabled(), true)
  await page.getByRole("button", { name: "Discard edits", exact: true }).click()
  await page.getByRole("button", { name: "Reset to defaults", exact: true }).click()
  await page.getByRole("button", { name: "Confirm reset", exact: true }).click()
  await page.waitForFunction(
    () => (document.querySelector("#media-ffprobe") as HTMLInputElement).value === "ffprobe"
  )
  await page.getByRole("button", { name: "Restart application", exact: true }).click()
  await page
    .getByText("Native application restart and exit are unavailable in this browser preview.", {
      exact: true,
    })
    .waitFor()
  await page.setViewportSize({ width: 720, height: 650 })
  await page.getByLabel("ffprobe", { exact: true }).focus()
  await page.keyboard.press("Tab")
  assert.equal(await page.locator(":focus").getAttribute("id"), "media-ffmpeg")
  await page.screenshot({ path: join(output, "narrow.png"), fullPage: true })
  await preview.close()
  await backend.stop()
  await promisify(execFile)(
    "uv",
    [
      "run",
      "python",
      "-c",
      "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(\"UPDATE locus_settings_values SET payload='{}'\"); c.commit(); c.close()",
      join(data.library, "metadata.sqlite"),
    ],
    { cwd: workspace, windowsHide: true }
  )
  backend = await data.start()
  preview = await browserPreview(backend)
  const requests: string[] = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(new URL(request.url()).pathname)
  })
  await page.goto(`${preview.origin}/#/entity`)
  await page.getByText("Library needs attention", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Reset to defaults", exact: true }).waitFor()
  assert.equal(await page.getByLabel("ffprobe", { exact: true }).inputValue(), "")
  assert.equal(await page.getByRole("button", { name: "Reset to defaults", exact: true }).isEnabled(), true)
  assert(
    !requests.some((path) => /entities|events|import-batches|tasks/.test(path)),
    JSON.stringify(requests)
  )
  await page.screenshot({ path: join(output, "repair.png"), fullPage: true })
  await page.getByRole("button", { name: "Reset to defaults", exact: true }).click()
  await page.getByRole("button", { name: "Confirm reset", exact: true }).click()
  await page.waitForFunction(
    () => (document.querySelector("#media-ffprobe") as HTMLInputElement).value === "ffprobe"
  )
  assert.equal((await backend.client.GET("/api/v1/server")).data?.availability.status, "restricted")
  assert.deepEqual(errors, [])
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        checks: [
          "pending runtime observation does not imply failed startup or required restart",
          "navigation retains draft",
          "explicit save and active environment attribution",
          "invalid input",
          "guarded reset",
          "browser cannot relaunch",
          "keyboard/narrow layout",
          "restricted repair without business consumers",
          "repair stays restricted",
        ],
      },
      null,
      2
    )
  )
  console.log(JSON.stringify({ passed: true, output }))
} finally {
  releaseRuntime()
  await browser.close()
  await preview.close()
  await data.dispose()
}

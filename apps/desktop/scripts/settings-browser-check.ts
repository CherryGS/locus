import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { once } from "node:events"
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
const runtimeResponse = new Promise<void>((resolve) => {
  releaseRuntime = resolve
})
let reservedPort: ReturnType<typeof createServer> | undefined
const externalChecks: string[] = []
try {
  await page.route("**/api/v1/settings/media-runtime", async (route) => {
    await runtimeResponse
    await route.continue().catch(() => {})
  })
  await page.goto(`${preview.origin}/#/setting`)
  await page.getByRole("button", { name: "Media tools", exact: true }).click()
  await page.getByLabel("ffprobe", { exact: true }).waitFor()
  await page.waitForFunction(() => !(document.querySelector("#media-ffprobe") as HTMLInputElement)?.disabled)
  assert.equal(await page.getByLabel("ffprobe", { exact: true }).inputValue(), "ffprobe")
  assert.equal(await page.getByText("Saved · restart required", { exact: true }).count(), 0)
  assert.equal(
    await page.getByText("Media did not start; active tool paths are unavailable.", { exact: true }).count(),
    0,
  )
  await page.getByText("Reading the current runtime configuration…", { exact: true }).waitFor()
  releaseRuntime()
  await page.locator("dd").filter({ hasText: "explicit-environment-probe" }).waitFor()
  await page.unroute("**/api/v1/settings/media-runtime")
  await page.getByLabel("ffprobe", { exact: true }).fill("saved-probe")
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await page.getByRole("button", { name: "Setting", exact: true }).click()
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
    () => (document.querySelector("#media-ffprobe") as HTMLInputElement).value === "ffprobe",
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
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByRole("button", { name: "External connection", exact: true }).click()
  const external = page.getByRole("region", { name: "External connection", exact: true })
  const token = page.getByRole("region", { name: "Shared Token", exact: true })
  const initialRuntime = (await backend.client.GET("/api/v1/external-access/runtime")).data!
  const initialToken = (await backend.client.GET("/api/v1/external-access/token")).data!
  assert.equal(initialToken.status, "current")
  await page.waitForFunction(() => !!(document.querySelector("#external-token") as HTMLInputElement)?.value)
  assert.equal(await page.getByLabel("Current Token", { exact: true }).getAttribute("type"), "password")
  await token.getByRole("button", { name: "Reveal Token", exact: true }).click()
  assert.equal(await page.getByLabel("Current Token", { exact: true }).getAttribute("type"), "text")
  await page.getByLabel("Current Token", { exact: true }).press("Control+A")
  assert(await page.getByLabel("Current Token", { exact: true }).evaluate((input: HTMLInputElement) =>
    input.selectionStart === 0 && input.selectionEnd === input.value.length && input.value.length > 0))
  await token.getByRole("button", { name: "Hide Token", exact: true }).click()
  // Selection is native. Clicking or pressing Enter must not write to clipboard.
  await page.evaluate(
    "window.__settingsCopied = 0; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText() { window.__settingsCopied++ } } })",
  )
  await page.getByLabel("Current Token", { exact: true }).click()
  await page.getByLabel("Current Token", { exact: true }).press("Enter")
  assert.equal(await page.evaluate("window.__settingsCopied"), 0)
  assert.equal(await external.getByRole("button", { name: /^Copy / }).count(), 0)
  externalChecks.push(
    "masked/revealed Token supports native selection without copy controls or click/Enter clipboard writes",
  )

  let resets = 0
  await page.route("**/api/v1/external-access/token/reset", async (route) => {
    resets++
    const response = await route.fetch()
    if (resets === 1) await route.abort("failed")
    else await route.fulfill({ response })
  })
  await token.getByRole("button", { name: "Reset shared Token", exact: true }).click()
  await token.getByText("Reset not confirmed", { exact: true }).waitFor()
  assert.equal(
    await token.getByRole("button", { name: "Reset shared Token", exact: true }).isDisabled(),
    true,
  )
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await page.getByRole("button", { name: "Setting", exact: true }).click()
  await token.getByRole("button", { name: "Recover Token reset", exact: true }).click()
  await token.getByText("Token reset completed.", { exact: true }).waitFor()
  await page.waitForFunction(() => !!(document.querySelector("#external-token") as HTMLInputElement)?.value)
  assert.equal(resets, 1)
  const replacementToken = (await backend.client.GET("/api/v1/external-access/token")).data!
  assert(initialToken.status === "current" && replacementToken.status === "current")
  assert(initialToken.token !== replacementToken.token, "Original reset did not replace the test credential")
  assert.equal(replacementToken.context_id, initialToken.context_id)
  assert((await page.getByLabel("Current Token", { exact: true }).inputValue()) === replacementToken.token)
  assert.equal(await page.getByLabel("Current Token", { exact: true }).getAttribute("type"), "password")
  await page.unroute("**/api/v1/external-access/token/reset")
  externalChecks.push("lost real reset response recovers after navigation without another rotation")

  await page.route("**/api/v1/external-access/token", (route) => route.abort("failed"))
  await token.getByRole("button", { name: "Read current Token", exact: true }).click()
  await token.getByText("Token observation unavailable", { exact: true }).waitFor()
  assert.equal(await page.getByLabel("Current Token", { exact: true }).inputValue(), "")
  assert.equal(
    await token.getByRole("button", { name: "Reset shared Token", exact: true }).isDisabled(),
    true,
  )
  await page.unroute("**/api/v1/external-access/token")
  await token.getByRole("button", { name: "Read current Token", exact: true }).click()
  await page.waitForFunction(() => !!(document.querySelector("#external-token") as HTMLInputElement)?.value)
  assert.equal(resets, 1)
  externalChecks.push("failed current observation cannot advertise or reset a cached Token")

  reservedPort = createServer()
  reservedPort.listen(0, "127.0.0.1")
  await once(reservedPort, "listening")
  const bound = reservedPort.address()
  assert(bound && typeof bound !== "string")
  const occupiedAddress = `127.0.0.1:${bound.port}`
  await page.getByLabel("Saved address", { exact: true }).fill(occupiedAddress)
  await page.getByRole("button", { name: "Close", exact: true }).click()
  await page.getByRole("button", { name: "Setting", exact: true }).click()
  assert.equal(await page.getByLabel("Saved address", { exact: true }).inputValue(), occupiedAddress)
  await external.getByRole("button", { name: "Save address", exact: true }).click()
  await external.getByText("Saved · restart required", { exact: true }).waitFor()
  assert.equal(
    (await backend.client.GET("/api/v1/external-access/runtime")).data!.active_address,
    initialRuntime.active_address,
  )
  await page.screenshot({ path: join(output, "external-pending.png"), fullPage: true })
  await preview.close()
  await backend.stop()
  backend = await data.start()
  preview = await browserPreview(backend)
  assert.equal(backend.availability.status, "normal")
  await page.goto(`${preview.origin}/#/entity`)
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  await page.getByRole("button", { name: "Setting", exact: true }).click()
  await external.getByText("External entry unavailable", { exact: true }).waitFor()
  assert.equal(await external.getByRole("button", { name: "Copy address", exact: true }).count(), 0)
  const beforeAddressReset = (await backend.client.GET("/api/v1/external-access/token")).data!
  await external.getByRole("button", { name: "Restore default address", exact: true }).click()
  await external.getByText("Saved · restart required", { exact: true }).waitFor()
  assert.equal((await backend.client.GET("/api/v1/external-access/runtime")).data!.active_address, null)
  const afterAddressReset = (await backend.client.GET("/api/v1/external-access/token")).data!
  assert(beforeAddressReset.status === "current" && afterAddressReset.status === "current")
  assert(beforeAddressReset.token === afterAddressReset.token, "Address reset must not rotate Token")
  await page.screenshot({ path: join(output, "external-unavailable.png"), fullPage: true })
  await new Promise<void>((resolve) => reservedPort!.close(() => resolve()))
  reservedPort = undefined
  externalChecks.push(
    "address draft/navigation/save, unchanged active listener, occupied-port normal browsing, group default reset independent of Token",
  )
  await preview.close()
  await backend.stop()
  await promisify(execFile)(
    "uv",
    [
      "run",
      "python",
      "-c",
      "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(\"UPDATE locus_settings_comm_group_value SET payload='{}' WHERE group_id='25c3fd2a-4148-4cb3-aca4-47c3ce3402e5'\"); c.commit(); c.close()",
      join(data.library, "metadata.sqlite"),
    ],
    { cwd: workspace, windowsHide: true },
  )
  backend = await data.start()
  preview = await browserPreview(backend)
  const requests: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    // A departing page may retry its old event stream during navigation.
    if (url.origin === preview.origin && url.pathname.startsWith("/api/")) requests.push(url.pathname)
  })
  await page.goto(`${preview.origin}/#/entity`)
  await page.getByText("Library needs attention", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Reset to defaults", exact: true }).waitFor()
  assert.equal(await page.getByLabel("ffprobe", { exact: true }).inputValue(), "")
  assert.equal(await page.getByRole("button", { name: "Reset to defaults", exact: true }).isEnabled(), true)
  assert(
    !requests.some((path) => /entities|events|import-batches|tasks/.test(path)),
    JSON.stringify(requests),
  )
  await page.screenshot({ path: join(output, "repair.png"), fullPage: true })
  await page.getByRole("button", { name: "Reset to defaults", exact: true }).click()
  await page.getByRole("button", { name: "Confirm reset", exact: true }).click()
  await page.waitForFunction(
    () => (document.querySelector("#media-ffprobe") as HTMLInputElement).value === "ffprobe",
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
          ...externalChecks,
        ],
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ passed: true, output }))
} finally {
  if (reservedPort?.listening) await new Promise<void>((resolve) => reservedPort!.close(() => resolve()))
  releaseRuntime()
  await browser.close()
  await preview.close()
  await data.dispose()
}

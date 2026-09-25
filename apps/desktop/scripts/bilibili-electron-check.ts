import { chooseContentView, hasContentView } from "./content-view-choice.ts"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { _electron as electron } from "playwright"
import { bilibiliFixture } from "./bilibili-fixture.ts"
import { binary, desktop, outputDirectory } from "./fixture.ts"

const require = createRequire(import.meta.url)
const data = await bilibiliFixture()
const output = await outputDirectory("bilibili-native")
let application: Awaited<ReturnType<typeof electron.launch>> | undefined
try {
  await (await data.start()).stop()
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({
    executablePath: require("electron"),
    args: [join(desktop, "scripts/electron-test-entry.cjs")],
    env: { ...env, LOCUS_DATA_DIR: data.library, LOCUS_SERVER_BINARY: binary, LOCUS_DESKTOP_HIDDEN: "1" },
  })
  const page = await application.firstWindow()
  page.setDefaultTimeout(15000)
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const entry = data.entries.find((entry) => entry.name === "complete")!
  await page.locator('[role="gridcell"][id$="-' + entry.entityId + '"]').dblclick()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  if (await hasContentView(page, "Bilibili")) await chooseContentView(page, "Bilibili")
  await page.locator('[data-view-id="bilibili.read"]').waitFor()
  const ready = () => page.locator('[data-slot="video-viewport"][data-state="ready"]').waitFor()
  const video = page.locator("video")
  await ready()
  assert.equal(await video.evaluate((v: HTMLVideoElement) => v.paused), true)
  assert((await video.getAttribute("src"))?.endsWith(`/files/${entry.mainFile}/bytes`))
  await video.focus()
  await page.keyboard.press("Space")
  await page.waitForFunction(() => !document.querySelector("video")!.paused && document.querySelector("video")!.currentTime > 0.1)
  await video.evaluate((v: HTMLVideoElement) => {
    v.pause()
    v.currentTime = 1
    v.volume = 0.35
    v.muted = true
    ;(window as any).__bilibiliNativePlayer = v
  })
  await page.waitForFunction(() => !document.querySelector("video")!.seeking)
  const destination = page.url()
  await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click()
  await page.waitForFunction(() => !!document.fullscreenElement)
  await page.keyboard.press("Escape")
  await page.waitForFunction(() => !document.fullscreenElement)
  assert.equal(page.url(), destination)
  assert.equal(await video.evaluate((v: HTMLVideoElement) => v.paused), true)
  await page.getByRole("link", { name: "Setting", exact: true }).click()
  await page.getByRole("navigation", { name: "Settings categories" }).waitFor()
  assert(await page.evaluate(() => {
    const previous = (window as any).__bilibiliNativePlayer as HTMLVideoElement
    return previous.paused && !previous.isConnected && !previous.getAttribute("src")
  }))
  await page.getByRole("button", { name: "Return", exact: true }).click()
  await page.locator('[data-view-id="bilibili.read"]').waitFor()
  await ready()
  assert.equal(page.url(), destination)
  const restored = await video.evaluate((v: HTMLVideoElement) => ({ time: v.currentTime, paused: v.paused, volume: v.volume, muted: v.muted }))
  assert(Math.abs(restored.time - 1) < 0.15)
  assert.deepEqual({ paused: restored.paused, volume: restored.volume, muted: restored.muted }, { paused: true, volume: 0.35, muted: true })
  await chooseContentView(page, "Video")
  await ready()
  assert.equal(await video.count(), 1)
  assert(Math.abs(await video.evaluate((v: HTMLVideoElement) => v.currentTime) - 1) < 0.15)
  assert.equal(await video.evaluate((v: HTMLVideoElement) => v.paused), true)
  await chooseContentView(page, "Bilibili")
  await ready()
  await page.screenshot({ path: join(output, "bilibili-playback.png") })
  assert.deepEqual(errors, [])
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: true, restored, checks: ["native local playback", "manual start", "fullscreen Escape", "Settings departure releases decoder", "paused position/audio return", "one player across Bilibili and Video views"] }, null, 2))
  console.log(JSON.stringify({ passed: true, output }))
} finally {
  if (application) await application.evaluate(({ app }) => {
    for (const child of (globalThis as any).__desktopTest.children)
      if (child.exitCode === null) child.kill()
    app.exit(0)
  }).catch(() => {})
  await data.dispose()
}

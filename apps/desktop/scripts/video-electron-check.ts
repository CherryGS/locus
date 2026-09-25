import { chooseContentView } from "./content-view-choice.ts"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { _electron as electron, type Page } from "playwright"
import { createLocusClient } from "@locus/client"
import { desktop, binary, outputDirectory } from "./fixture.ts"
import { videoFixture } from "./video-fixture.ts"

const require = createRequire(import.meta.url)
const data = await videoFixture(),
  output = await outputDirectory("video-native")
let application: Awaited<ReturnType<typeof electron.launch>> | undefined
const ranges: { range?: string; status: number; length?: string; contentRange?: string }[] = []
const errors: string[] = []
async function ready(page: Page) {
  await page.locator('[data-slot="video-viewport"][data-state="ready"]').waitFor()
  await page.waitForFunction(() => {
    const v = document.querySelector("video")
    return v && !v.seeking && v.readyState >= 2
  })
}
const state = (page: Page) =>
  page.locator("video").evaluate((v: HTMLVideoElement) => ({
    time: v.currentTime,
    paused: v.paused,
    volume: v.volume,
    muted: v.muted,
    ended: v.ended,
    src: v.currentSrc,
  }))
const play = async (page: Page) => {
  await page.locator("video").focus()
  await page.keyboard.press("Space")
  await page.waitForFunction(() => !document.querySelector("video")!.paused)
}
try {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
  )
  delete env.ELECTRON_RUN_AS_NODE
  const launch = async () => {
    application = await electron.launch({
      executablePath: require("electron"),
      args: [join(desktop, "scripts/electron-test-entry.cjs")],
      env: { ...env, LOCUS_DATA_DIR: data.library, LOCUS_SERVER_BINARY: binary, LOCUS_DESKTOP_HIDDEN: "1" },
    })
    const page = await application.firstWindow()
    page.setDefaultTimeout(15000)
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("response", (response) => {
      if (/\/files\/.+\/bytes$/.test(response.url()))
        ranges.push({
          range: response.request().headers().range,
          status: response.status(),
          length: response.headers()["content-length"],
          contentRange: response.headers()["content-range"],
        })
    })
    await page.getByRole("grid", { name: "Entities" }).waitFor()
    assert.equal(
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      false,
    )
    return page
  }
  let page = await launch()
  const shellReturn = page
    .locator("header.title-bar")
    .getByRole("button", { name: "Return to source", exact: true })
  assert(await shellReturn.isDisabled())
  assert.deepEqual((await page.locator("header.title-bar button").all()).length >= 4, true)
  assert.deepEqual(
    await page
      .locator("header.title-bar button")
      .evaluateAll((nodes) =>
        nodes.slice(0, 4).map((n) => n.getAttribute("aria-label") ?? n.textContent?.trim()),
      ),
    ["Back", "Forward", "Return to source", "Import"],
  )
  console.log("Video: manual entry and native controls")
  await page.getByRole("gridcell").first().dblclick()
  await ready(page)
  assert(await shellReturn.isEnabled())
  assert.equal((await state(page)).paused, true)
  assert.equal((await state(page)).time, 0)
  assert((await state(page)).src.endsWith(`/files/${data.videos[0].fileId}/bytes`))
  console.log("Video: play, seek and temporary overlays")
  await play(page)
  await page.waitForFunction(() => document.querySelector("video")!.currentTime > 0.2)
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 4
    v.volume = 0.35
    v.muted = true
  })
  await page.waitForFunction(() => !document.querySelector("video")!.seeking)
  // Control keyboard seeking is not neighboring-Entity navigation.
  const destination = page.url()
  await page.locator("video").focus()
  await page.keyboard.press("ArrowRight")
  await page.waitForFunction(() => document.querySelector("video")!.currentTime > 8.5)
  assert.equal(page.url(), destination)
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 1
  })
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  await page.getByRole("button", { name: "Reread Entity", exact: true }).click()
  await page.waitForFunction(
    () =>
      !document.querySelector('[aria-label="Entity"]')?.getAttribute("data-pending-metadata") ||
      document.querySelector('[aria-label="Entity"]')?.getAttribute("data-pending-metadata") === "0",
  )
  assert.equal((await state(page)).paused, false)
  await page.getByRole("button", { name: /^Tasks/ }).click()
  await page.getByRole("dialog", { name: "Tasks this run" }).waitFor()
  const duringModal = (await state(page)).time
  await page.waitForFunction((t) => document.querySelector("video")!.currentTime > t + 0.15, duringModal)
  await page.keyboard.press("Escape")
  await page.getByRole("dialog", { name: "Tasks this run" }).waitFor({ state: "hidden" })
  assert.equal(page.url(), destination)
  console.log("Video: Settings excursion pauses and restores the original visit")
  const settingsDeparture = await state(page)
  const videoVisit = await page.evaluate(() => history.state.__TSR_key)
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    ;(window as any).__settingsVideo = v
  })
  await page.getByRole("link", { name: "Setting", exact: true }).click()
  await page.getByRole("heading", { name: "External connection", exact: true }).waitFor()
  assert.equal(await page.locator("video").count(), 0)
  assert(
    await page.evaluate(
      () => (window as any).__settingsVideo.paused && !(window as any).__settingsVideo.getAttribute("src"),
    ),
  )
  await page.getByRole("button", { name: "Media tools", exact: true }).click()
  await page.getByRole("button", { name: "Return", exact: true }).click()
  await ready(page)
  const settingsReturn = await state(page)
  assert.equal(page.url(), destination)
  assert.equal(await page.evaluate(() => history.state.__TSR_key), videoVisit)
  assert.equal(settingsReturn.src, settingsDeparture.src)
  assert(settingsReturn.paused && settingsReturn.time >= settingsDeparture.time - 0.2)
  assert.equal(settingsReturn.volume, settingsDeparture.volume)
  assert.equal(settingsReturn.muted, settingsDeparture.muted)
  await play(page)
  // Retain the old node only inside this test to observe release, not production.
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    ;(window as any).__departedVideo = v
  })
  console.log("Video: departure and history return")
  const left = (await state(page)).time
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  await ready(page)
  assert(
    await page.evaluate(
      () => (window as any).__departedVideo.paused && !(window as any).__departedVideo.getAttribute("src"),
    ),
  )
  assert.equal((await state(page)).paused, true)
  assert.equal((await state(page)).volume, 0.35)
  assert.equal((await state(page)).muted, true)
  await page.locator("video").focus()
  await page.keyboard.press("Alt+ArrowLeft")
  await ready(page)
  const returned = await state(page)
  assert(returned.paused && returned.time >= left - 0.2)
  await play(page)
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 1
  })
  console.log("fullscreen", await state(page))
  await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click()
  await page.waitForFunction(() => !!document.fullscreenElement)
  assert.equal(
    await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
    false,
  )
  await page.keyboard.press("Escape")
  await page.waitForFunction(() => !document.fullscreenElement)
  assert.equal(page.url(), destination)
  console.log("fullscreen exited", await state(page))
  assert.equal((await state(page)).paused, false)
  await page.keyboard.press("Escape")
  await page.getByRole("grid", { name: "Entities" }).waitFor()
  assert(await shellReturn.isDisabled())
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await ready(page)
  console.log("Video: completion and replay")
  // End is stable and replay is a manual action, without a history change.
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    v.currentTime = v.duration - 0.15
  })
  await play(page)
  await page.getByRole("button", { name: "Replay", exact: true }).waitFor()
  assert.equal(page.url(), destination)
  assert.equal((await state(page)).ended, true)
  await page.getByRole("button", { name: "Replay", exact: true }).click()
  await page.waitForFunction(
    () => !document.querySelector("video")!.paused && document.querySelector("video")!.currentTime < 2,
  )
  console.log("Video: resource failure and retry")
  // A byte failure followed by explicit retry rechecks current context and
  // restores progress paused. Ordinary metadata success cannot clear it.
  await page.locator("video").evaluate((v: HTMLVideoElement) => {
    v.pause()
    v.currentTime = 3
  })
  await page.waitForFunction(() => !document.querySelector("video")!.seeking)
  await page.route(`**/files/${data.videos[0].fileId}/bytes`, (route) => route.abort())
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  await ready(page)
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await page.getByRole("button", { name: "Retry video", exact: true }).waitFor()
  const problemBeforeLateEvent = await page.getByLabel("Entity problems", { exact: true }).innerText()
  await page.locator("video").evaluate((video: HTMLVideoElement) => {
    // Simulate a queued success notification arriving after the terminal error.
    // The actual next reload gets a new element and ordinary native properties.
    Object.defineProperties(video, {
      readyState: { value: 2 },
      videoWidth: { value: 320 },
      videoHeight: { value: 180 },
    })
    video.dispatchEvent(new Event("loadedmetadata"))
    video.dispatchEvent(new Event("loadeddata"))
    video.dispatchEvent(new Event("seeked"))
  })
  assert.equal(await page.getByLabel("Entity problems", { exact: true }).innerText(), problemBeforeLateEvent)
  await page.unroute(`**/files/${data.videos[0].fileId}/bytes`)
  await page.getByRole("button", { name: "Retry video", exact: true }).click()
  await ready(page)
  assert.equal((await state(page)).paused, true)
  assert(Math.abs((await state(page)).time - 3) < 0.2)
  // Make the native seek complete at another position once. This must end as
  // a paused restoration failure, and must not overwrite the saved position.
  await page.evaluate((fileId) => {
    const original = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime")!
    ;(window as any).__restoreCurrentTime = () =>
      Object.defineProperty(HTMLMediaElement.prototype, "currentTime", original)
    let shifted = false
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get: original.get,
      set(this: HTMLMediaElement, position: number) {
        if (!shifted && this.currentSrc.endsWith(`/files/${fileId}/bytes`) && position === 3) {
          shifted = true
          original.set!.call(this, position + 1)
        } else original.set!.call(this, position)
      },
    })
  }, data.videos[0].fileId)
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  await ready(page)
  await page.getByRole("button", { name: "Back", exact: true }).click()
  await page
    .getByText("The saved playback position could not be restored. Retry to recheck the current input.", {
      exact: true,
    })
    .first()
    .waitFor()
  assert.equal((await state(page)).paused, true)
  await page.evaluate(() => (window as any).__restoreCurrentTime())
  await page.getByRole("button", { name: "Retry video", exact: true }).click()
  await ready(page)
  assert.equal((await state(page)).paused, true)
  assert(Math.abs((await state(page)).time - 3) < 0.2)
  console.log("Video: current File replacement")
  // Same-session actual File replacement resets position, without interpretation.
  const host = await application!.evaluate(() => {
    const t = (globalThis as any).__desktopTest
    return { origin: t.ready.origin, runId: t.ready.run_id, credential: t.bootstrap.credential }
  })
  const client = createLocusClient(host, (input, init) => {
    const r = new Request(input, init)
    r.headers.set("Authorization", `Bearer ${host.credential}`)
    return fetch(r)
  })
  const fileKind = "9fd73d3d-d35d-41bc-8b73-402e12f5c017"
  const entityId = data.videos[0].entityId
  const imported = await client.POST("/api/v1/imports", {
    body: { request_id: randomUUID(), source_path: data.videos[1].source },
  })
  assert(imported.data)
  let replacement = ""
  for (;;) {
    const result = await client.GET("/api/v1/tasks/{task_id}/outcome", {
      params: { path: { task_id: imported.data.task_id } },
    })
    if (result.data?.status === "complete") {
      assert(result.data.outcome.status === "imported")
      replacement = result.data.outcome.file.file_id
      break
    }
    await new Promise((r) => setTimeout(r, 10))
  }
  const detached = await client.POST("/api/v1/memberships/detach", {
    body: {
      request_id: randomUUID(),
      membership: { entity_id: entityId, kind_id: fileKind, component_id: data.videos[0].fileId },
    },
  })
  assert(detached.data)
  const attached = await client.POST("/api/v1/memberships/attach", {
    body: {
      request_id: randomUUID(),
      membership: { entity_id: entityId, kind_id: fileKind, component_id: replacement },
    },
  })
  assert(attached.data)
  await page.getByRole("button", { name: "Reread Entity", exact: true }).click()
  await page.waitForFunction(
    (file) => document.querySelector("video")?.currentSrc.endsWith(`/files/${file}/bytes`),
    replacement,
  )
  await ready(page)
  assert.equal((await state(page)).time, 0)
  assert.equal((await state(page)).paused, true)
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  await ready(page)
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  await page.getByRole("button", { name: "Retry video", exact: true }).waitFor()
  await page
    .getByText(/This input could not be played/)
    .first()
    .waitFor()
  await page.getByRole("button", { name: "Retry video", exact: true }).click()
  await page.getByRole("button", { name: "Retry video", exact: true }).waitFor({ state: "visible" })
  await page.getByRole("button", { name: "Previous entity", exact: true }).click()
  await ready(page)
  console.log("Video: close preparation and canceled close")
  // Hold an accepted preference response so close preparation can be canceled.
  let releaseSave!: () => void
  let saveStarted!: () => void
  const heldSave = new Promise<void>((resolve) => {
    releaseSave = resolve
  })
  const startedSave = new Promise<void>((resolve) => {
    saveStarted = resolve
  })
  await page.route("**/view-preference", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue()
      return
    }
    const response = await route.fetch({
      headers: {
        ...route.request().headers(),
        Authorization: `Bearer ${host.credential}`,
        "X-Locus-Run": host.runId,
      },
    })
    saveStarted()
    await heldSave
    await route.fulfill({ response })
  })
  await chooseContentView(page, "Video")
  await Promise.race([
    startedSave,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Preference save did not start")), 15000)),
  ])
  await play(page)
  await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click()
  await page.waitForFunction(() => !!document.fullscreenElement)
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await page.waitForFunction(() => !document.fullscreenElement)
  await page.waitForFunction(() => document.querySelector("video")!.paused)
  const close = await page.evaluate(() => window.locusDesktop!.state())
  assert.equal(close.close.phase, "preparing")
  if (close.close.phase === "preparing")
    await page.evaluate(
      (attemptId) => window.locusDesktop!.closeAction({ attemptId, action: "return" }),
      close.close.attemptId,
    )
  await page.waitForFunction(async () => (await window.locusDesktop!.state()).close.phase === "idle")
  assert.equal((await state(page)).paused, true)
  // A fullscreen request whose native completion arrives after stop cannot
  // cover the close/return UI or revive playback in the same player binding.
  await page.locator('[data-slot="video-viewport"]').evaluate((element) => {
    const target = element as HTMLElement
    const original = target.requestFullscreen.bind(target)
    target.requestFullscreen = () =>
      new Promise<void>((resolve, reject) => {
        ;(window as any).__completeStoppedFullscreen = async () => {
          try {
            await original()
            resolve()
          } catch (error) {
            reject(error)
          }
          target.requestFullscreen = original
        }
      })
  })
  await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click()
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await page.getByRole("button", { name: "Return to Locus", exact: true }).click()
  await page.waitForFunction(async () => (await window.locusDesktop!.state()).close.phase === "idle")
  await page.evaluate(() => (window as any).__completeStoppedFullscreen())
  await page.waitForFunction(() => !document.fullscreenElement)
  assert.equal((await state(page)).paused, true)
  assert.equal(
    await page
      .getByText("Fullscreen is unavailable. You can continue watching here.", { exact: true })
      .count(),
    0,
  )
  releaseSave()
  const overview = page.getByRole("button", { name: "Overview", exact: true })
  if ((await overview.getAttribute("aria-expanded")) !== "true") await overview.click()
  await page
    .getByRole("status", { name: "Choice saved", exact: true })
    .waitFor()
    .catch(async (error) => {
      console.log(await page.locator("body").innerText())
      throw error
    })
  const closed = application!.waitForEvent("close")
  await application!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  application = undefined
  page = await launch()
  await page.getByRole("gridcell").nth(1).dblclick()
  await ready(page)
  assert.deepEqual(
    {
      time: (await state(page)).time,
      paused: (await state(page)).paused,
      volume: (await state(page)).volume,
      muted: (await state(page)).muted,
    },
    { time: 0, paused: true, volume: 1, muted: false },
  )
  assert(ranges.some((r) => r.range && r.status === 206 && r.contentRange && Number(r.length) > 0))
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(output, "video.png") })
  await play(page)
  console.log("Video: background and minimization")
  await application!.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].blur()
    BrowserWindow.getAllWindows()[0].minimize()
  })
  const minimized = (await state(page)).time
  await page.waitForFunction((t) => document.querySelector("video")!.currentTime > t + 0.15, minimized, {
    polling: 100,
  })

  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        passed: true,
        ranges,
        errors,
        supported: ["H264/AAC MP4", "VP9/Opus WebM"],
        rejected: "FFV1 MKV",
        checks: [
          "manual start",
          "native play/seek controls",
          "shared audio",
          "same-input metadata preserves playback",
          "task modal",
          "hidden background/minimized",
          "A/B/A paused return",
          "departure releases src",
          "fullscreen Esc then source Esc",
          "manual replay",
          "byte failure/retry paused restore",
          "actual File replacement resets",
          "unsupported retry",
          "close/canceled-close pauses",
          "restart resets",
          "persistent shell order/disabled action",
          "focused-player history shortcuts",
          "terminal error rejects queued success",
          "failed seek restoration preserves paused progress",
          "late fullscreen completion after stop exits",
        ],
      },
      null,
      2,
    ),
  )
  console.log(`PASS production hidden Electron Video lifecycle. ${output}`)
} finally {
  if (application)
    await application
      .evaluate(({ app }) => {
        for (const child of (globalThis as any).__desktopTest.children)
          if (child.exitCode === null) child.kill()
        app.exit(0)
      })
      .catch(() => {})
  await data.dispose()
}

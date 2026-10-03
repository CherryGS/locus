import assert from "node:assert/strict"
import { chooseContentView, hasContentView } from "./content-view-choice.ts"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { chromium } from "playwright"
import { twitterFixture } from "./twitter-fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { outputDirectory } from "./fixture.ts"
const data = await twitterFixture(true)
const backend = await data.start()
const preview = await browserPreview(backend)
const output = await outputDirectory("twitter-browser")
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors: string[] = [], remote: string[] = [], reads: string[] = []
  page.on("pageerror", e => errors.push(e.message))
  page.on("request", r => { if (new URL(r.url()).origin !== preview.origin) remote.push(r.url()); if (r.url().includes("/twitter/")) reads.push(r.url()) })
  // The actual generated factory reads the real retained provider fixture.
  for (const entry of data.entries) {
    const value = await backend.client.GET("/api/v1/twitter/{component_id}/view", { params: { path: { component_id: entry.componentId } } })
    assert.equal(!!value.data, !["corrupt", "missing-record", "future-version"].includes(entry.name))
    if (entry.name === "complete") assert.equal(value.data!.record.snapshot.representation!.claims!.duration_ms, "9007199254740993")
  }
  await page.goto(`${preview.origin}/#/entity`)
  await page.getByRole("gridcell").first().waitFor()
  for (const name of ["locator-only", "partial-empty"]) {
    const entry = data.entries.find(e => e.name === name)!
    const card = page.locator(`[role="gridcell"][id$="-${entry.entityId}"]`)
    await page.locator(`[role="gridcell"][id$="-${entry.entityId}"][aria-busy="false"]`).waitFor()
    assert.equal(await card.getByRole("img", {name:"Entity has problems"}).count(), 0)
  }
  assert.equal((await backend.client.GET("/api/v1/tasks")).data?.tasks.length, 0, "metadata reads are not public business tasks")
  const open = async (name: string) => {
    const entry = data.entries.find(e => e.name === name)!
    // Existing card identity, not card title, determines the subject.
    await page.locator(`[role="gridcell"][id$="-${entry.entityId}"]`).dblclick()
    if (!await page.locator("#auxiliary-panel").count() || await page.locator("#auxiliary-panel").getAttribute("aria-label") !== "Overview")
      await page.getByRole("button", { name: "Overview", exact: true }).click()
    if (await hasContentView(page, "Twitter")) await chooseContentView(page, "Twitter")
    await page.locator('[data-slot="entity-inspection"][data-view-id="twitter.read"]').waitFor()
    return entry
  }
  const complete = await open("complete")
  await page.getByRole("article", { name: "Twitter post" }).getByText(/Saved complete observation/).waitFor()
  assert.equal(await page.getByRole("button", { name: "Enrich this File with Civitai", exact: true }).count(), 0)
  await page.locator('[data-slot="video-viewport"][data-state="ready"]').waitFor()
  assert(await page.locator("video").evaluate((video: HTMLVideoElement) => video.paused))
  await page.locator("video").evaluate(async (video: HTMLVideoElement) => {
    video.currentTime = 2
    video.muted = true
    ;(window as any).__twitterEmbeddedVideo = video
    await video.play()
  })
  await page.waitForFunction(() => !document.querySelector("video")!.paused)
  const beforeSettings = page.url()
  await page.getByRole("button", { name: "Setting", exact: true }).click()
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor()
  const pausedAt = await page.locator("video").evaluate((video: HTMLVideoElement) => {
    if (!video.paused) throw new Error("Settings must pause playback")
    return video.currentTime
  })
  await page.keyboard.press("Escape")
  await page.getByRole("dialog", { name: "Settings", exact: true }).waitFor({ state: "hidden" })
  assert.equal(page.url(), beforeSettings)
  assert(await page.evaluate(() => document.querySelector("video") === (window as any).__twitterEmbeddedVideo))
  assert.equal(await page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime), pausedAt)
  await chooseContentView(page, "Video")
  await page.locator('[data-slot="video-viewport"][data-state="ready"]').waitFor()
  assert(await page.evaluate(() => {
    const old = (window as any).__twitterEmbeddedVideo as HTMLVideoElement
    return old.paused && !old.getAttribute("src") && !old.isConnected
  }))
  assert(await page.locator("video").evaluate((video: HTMLVideoElement) => video.paused && video.currentTime >= 1.8))
  await chooseContentView(page, "Twitter")
  await page.locator('[data-slot="video-viewport"][data-state="ready"]').waitFor()
  assert(await page.locator("video").evaluate((video: HTMLVideoElement) => video.paused && video.currentTime >= 1.8))
  await page.screenshot({ path: join(output, "complete.png") })
  await page.getByRole("button", { name: "Open Twitter details", exact: true }).click()
  await page.getByText("Selected representation", { exact: true }).waitFor()
  const duration = page.getByLabel("Selected representation", { exact: true }).locator('[title="9007199254740993 ms"]')
  await duration.waitFor()
  assert.equal(await duration.innerText(), "2501999792:59:00.993", "the duration stays readable without rounding its exact millisecond claim")
  const author = page.locator('#auxiliary-panel').getByRole("region", { name: "Author", exact: true })
  assert(await author.getByText("9007199254740993", { exact: true }).isVisible(), "source identifiers remain selectable in their corresponding groups")
  await page.screenshot({ path: join(output, "details.png") })
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  const before = page.url()
  await page.route(`**/twitter/${complete.componentId}/view`, r => r.fulfill({ status:500, contentType:"application/json", body:JSON.stringify({code:"operation_failed",message:"Isolated Twitter read failure"}) }))
  await page.getByRole("button", { name: "Reread Entity", exact: true }).first().click()
  await page.getByText("Isolated Twitter read failure", { exact: true }).waitFor()
  assert(await page.getByRole("article").getByText(/Saved complete observation/).isVisible())
  assert.equal(page.url(),before)
  await page.screenshot({ path: join(output,"retained-reread.png") })
  await page.unroute(`**/twitter/${complete.componentId}/view`)
  await page.getByRole("button", { name: "Reread Entity", exact: true }).first().click()
  await page.getByRole("button", { name: "Return to source", exact: true }).click()
  for (const name of ["locator-only","partial-empty","changed-association","producer-issue","corrupt"]) {
    await open(name)
    if (name === "corrupt") {
      await page.getByText("Twitter capture unavailable",{exact:true}).waitFor()
      await page.getByRole("button",{name:"Open Twitter details",exact:true}).click()
      assert.equal(await page.getByText("Saved capture",{exact:true}).count(),0)
      assert.equal(await page.getByText("Not captured",{exact:true}).count(),0)
      await page.getByRole("button",{name:"Overview",exact:true}).click()
    }
    else await page.getByRole("article").waitFor()
    if (name === "changed-association") {
      assert(!/associated with File/.test(await page.getByRole("article").innerText()))
      await page.getByText(/saved capture is associated with File/).waitFor()
      assert.equal(await page.getByRole("region", {name:"Post media",exact:true}).count(),0)
    }
    if (name === "partial-empty") await page.getByText("No post text",{exact:true}).waitFor()
    await page.screenshot({path:join(output,`${name}.png`)})
    await page.getByRole("button", { name: "Return to source", exact: true }).click()
  }
  assert.deepEqual(remote,[])
  assert.deepEqual(errors,[])
  assert(reads.length < 50, "bounded fixture demand must not cause an unbounded read loop")
  await writeFile(join(output,"results.json"),JSON.stringify({generatedClient:true,remoteRequests:remote,componentReads:reads.length,errors},null,2))
  console.log(JSON.stringify({output,componentReads:reads.length}))
} finally { await browser.close(); await preview.close(); await data.dispose() }

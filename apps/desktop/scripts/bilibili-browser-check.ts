import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"
import { chromium, type Browser, type Page } from "playwright"
import { createLocusClient, uploadFile, ExternalAddressGroupId, type components } from "@locus/client"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { fixturePng } from "../../../packages/locus-client/smoke-png.ts"

const data = await fixture(),
  output = await outputDirectory("bilibili-browser")
let backend = await data.start()
let preview: Awaited<ReturnType<typeof browserPreview>> | undefined
let browser: Browser | undefined
let failurePage: Page | undefined
try {
  const reservation = createServer()
  reservation.listen(0, "127.0.0.1")
  await once(reservation, "listening")
  const address = reservation.address()
  assert(address && typeof address !== "string")
  const socket = `127.0.0.1:${address.port}`
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const saved = (
    await backend.client.GET("/api/v1/settings/groups/{group_id}", {
      params: { path: { group_id: ExternalAddressGroupId } },
    })
  ).data
  assert(saved?.status === "current")
  const changed = await backend.client.POST("/api/v1/settings/groups/{group_id}", {
    params: { path: { group_id: ExternalAddressGroupId } },
    body: {
      request_id: randomUUID(),
      change: {
        operation: "update",
        expected_revision: saved.saved.metadata.revision,
        value: { address: socket },
      },
    },
  })
  assert.equal(changed.data?.status, "settings_saved")
  await backend.stop()
  backend = await data.start()
  const token = (await backend.client.GET("/api/v1/external-access/token")).data
  assert(token?.status === "current")
  const context = { origin: `http://${socket}`, runId: backend.context.runId }
  const transport: typeof fetch = (input, init) => {
    const request = new Request(input, init)
    request.headers.set("Authorization", `Bearer ${token.token}`)
    return fetch(request)
  }
  const client = createLocusClient(context, transport)
  const complete = async (request_id: string) => {
    const signal = AbortSignal.timeout(30_000)
    for (;;) {
      const request = (
        await client.GET("/external/v1/requests/{request_id}", { params: { path: { request_id } }, signal })
      ).data
      assert(request && request.status !== "rejected", JSON.stringify(request))
      if (request.status === "accepted") {
        const result = (
          await client.GET("/external/v1/tasks/{task_id}/outcome", {
            params: { path: { task_id: request.receipt.task_id } },
            signal,
          })
        ).data
        if (result?.status === "complete") return result.outcome
      }
      await delay(20, undefined, { signal })
    }
  }
  const upload = async (bytes: Uint8Array<ArrayBuffer>, filename: string) => {
    const request_id = randomUUID()
    await uploadFile(
      context,
      { request_id, byte_count: String(bytes.byteLength), filename },
      bytes,
      transport,
    )
    const result = await complete(request_id)
    assert(result.status === "upload" && result.result.confirmed_file_id)
    return result.result.confirmed_file_id
  }
  const videoPath = join(data.root, "bilibili-selected-part.mp4")
  await promisify(execFile)(
    process.env.LOCUS_FFMPEG ?? "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=64x40:r=5:d=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-threads",
      "1",
      "-shortest",
      "-movflags",
      "+faststart",
      "-y",
      videoPath,
    ],
    { windowsHide: true, timeout: 20_000 },
  )
  const videoFile = await upload(new Uint8Array(await readFile(videoPath)), "selected-part.mp4")
  const coverFile = await upload(new Uint8Array(fixturePng(80, 50)), "submission-cover.png")
  const capture = {
    bvid: "BV145PxzCEoE",
    aid: "18446744073709551615",
    page_url: "https://www.bilibili.com/video/BV145PxzCEoE/?p=2",
    title: "Bilibili selected part fixture",
    description: "Full description\nSecond line with <b>plain text</b>",
    part: { cid: "36531930223", index: 2, title: "Selected part two", duration_ms: "2000" },
    uploader: { user_id: "123456789", display_name: "Fixture uploader" },
    published_at_unix_ms: "1720000000000",
    observed_at_unix_ms: "1720000001000",
  }
  const request_id = randomUUID()
  const items: components["schemas"]["RegisteredImportItem"][] = [
    {
      file_id: videoFile,
      bilibili: {
        ...capture,
        asset_role: "video",
        representation: {
          assembled: true,
          claims: {
            container: "mp4",
            video_codec: "avc1",
            audio_codec: "mp4a",
            audio_present: true,
            quality: "Selected source quality",
          },
        },
      },
    },
    { file_id: coverFile, bilibili: { ...capture, asset_role: "cover" } },
    { bilibili: { bvid: capture.bvid, page_url: "https://www.bilibili.com/video/BV145PxzCEoE/?p=1" } },
  ]
  const submitted = await client.POST("/external/v1/import-batches", { body: { request_id, items } })
  assert(submitted.data, JSON.stringify(submitted.error))
  await complete(request_id)
  const batch = (await client.GET("/external/v1/import-batches")).data?.batches.find(
    (value) => value.original_request_id === request_id,
  )
  assert(batch && batch.items.every((item) => item.current.complete), JSON.stringify(batch))
  assert.equal(new Set(batch.items.map((item) => item.current.bilibili_id)).size, 3)
  const [video, cover, locator] = batch.items
  assert(video.current.kinds.some((kind) => kind.kind === "video" && kind.preview.state === "success"))
  assert(cover.current.kinds.some((kind) => kind.kind === "image" && kind.preview.state === "success"))
  for (const entry of batch.items) {
    assert(entry.requested_bilibili && !entry.requested_twitter)
    const view = await backend.client.GET("/api/v1/bilibili/{component_id}/view", {
      params: { path: { component_id: entry.current.bilibili_id! } },
    })
    assert(view.data)
    assert.equal(view.data.record.snapshot.bvid, capture.bvid)
  }
  preview = await browserPreview(backend)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })
  failurePage = page
  page.setDefaultTimeout(15_000)
  const errors: string[] = [],
    remote: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== preview!.origin) remote.push(request.url())
  })
  await page.goto(`${preview.origin}/#/entity`)
  await page.locator(`[role="gridcell"][id$="${video.current.entity_id}"]`).dblclick()
  await page.locator("video").waitFor()
  await page.waitForFunction(() => (document.querySelector("video")?.readyState ?? 0) >= 1)
  if (!(await page.locator("#auxiliary-panel").count()) || await page.locator("#auxiliary-panel").getAttribute("aria-label") !== "Overview") {
    await page.getByRole("button", { name: "Overview", exact: true }).click()
  }
  await page.getByRole("button", { name: "Use Bilibili view", exact: true }).click()
  const article = page.getByRole("article", { name: "Bilibili video source" })
  await article.getByText("Selected part two", { exact: true }).waitFor()
  await article.getByText("Full description\nSecond line with <b>plain text</b>", { exact: true }).waitFor()
  assert.equal(await article.locator("b").count(), 0)
  assert.equal(
    await article.getByRole("link", { name: "Open selected part" }).getAttribute("href"),
    capture.page_url,
  )
  await page.screenshot({ path: join(output, "video-source.png") })
  await page.getByRole("button", { name: "Open Bilibili details", exact: true }).click()
  await page.getByText("18446744073709551615", { exact: true }).waitFor()
  await page.screenshot({ path: join(output, "source-details.png") })
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  await page.route(`**/bilibili/${video.current.bilibili_id}/view`, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: "operation_failed", message: "Isolated Bilibili read failure" }),
    }),
  )
  await page.getByRole("button", { name: "Reread Entity", exact: true }).first().click()
  await page.getByText("Isolated Bilibili read failure", { exact: true }).waitFor()
  assert(await article.getByText("Selected part two", { exact: true }).isVisible())
  await page.screenshot({ path: join(output, "retained-read.png") })
  await page.unroute(`**/bilibili/${video.current.bilibili_id}/view`)
  await page.getByRole("button", { name: "Return to source", exact: true }).click()
  await page.locator(`[role="gridcell"][id$="${cover.current.entity_id}"]`).dblclick()
  if (!(await page.locator("#auxiliary-panel").count()) || await page.locator("#auxiliary-panel").getAttribute("aria-label") !== "Overview") {
    await page.getByRole("button", { name: "Overview", exact: true }).click()
  }
  await page.getByRole("button", { name: "Use Bilibili view", exact: true }).click()
  await page.getByRole("article").getByText("Submission cover", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Return to source", exact: true }).click()
  await page.locator(`[role="gridcell"][id$="${locator.current.entity_id}"]`).dblclick()
  await page.getByRole("article").getByText("Part not captured", { exact: true }).waitFor()
  await page.screenshot({ path: join(output, "locator-only.png") })
  assert.deepEqual(errors, [])
  assert.deepEqual(remote, [])
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        externalUploadAndImport: true,
        actualVideo: true,
        identities: batch.items.map((item) => item.current.entity_id),
        errors,
        remote,
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ output, imported: batch.items.length, actualVideo: true, errors }))
} catch (error) {
  await failurePage?.screenshot({ path: join(output, "failure.png") })
  if (failurePage) await writeFile(join(output, "failure.html"), await failurePage.content())
  console.error(JSON.stringify({ output, failure: String(error) }))
  throw error
} finally {
  await browser?.close()
  await preview?.close()
  await data.dispose()
}

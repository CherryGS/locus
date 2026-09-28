import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { cpus, platform, release, totalmem } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { setTimeout as delay } from "node:timers/promises"
import { chromium } from "playwright"
import { readEntityIds } from "@locus/client"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"

const count = Number(process.argv[2] ?? 1_000_000)
assert(Number.isSafeInteger(count) && count >= 1)
const data = await fixture(count),
  backend = await data.start(),
  preview = await browserPreview(backend)
const output = await outputDirectory("renderer-scale")
const browser = await chromium.launch({
  headless: true,
  args: ["--enable-precise-memory-info"],
})
const execute = promisify(execFile)
async function memory(pid: number) {
  assert(Number.isSafeInteger(pid) && pid > 0)
  if (process.platform === "win32") {
    const value = await execute(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        `Get-Process -Id ${pid} | Select-Object WorkingSet64,PeakWorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`,
      ],
      { windowsHide: true },
    )
    return { pid, ...JSON.parse(value.stdout) }
  }
  if (process.platform === "linux") {
    const value = await readFile(`/proc/${pid}/status`, "utf8")
    return {
      pid,
      rssBytes: Number(value.match(/^VmRSS:\s+(\d+) kB/m)?.[1]) * 1024,
      peakRssBytes: Number(value.match(/^VmHWM:\s+(\d+) kB/m)?.[1]) * 1024,
    }
  }
  const value = await execute("ps", ["-o", "rss=", "-p", String(pid)])
  return { pid, sampledRssBytes: Number(value.stdout.trim()) * 1024 }
}
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
  })
  const browserSession = await browser.newBrowserCDPSession()
  const processes = async () => {
    const value = await browserSession.send("SystemInfo.getProcessInfo")
    return Promise.all(value.processInfo.filter((p) => p.type === "renderer").map((p) => memory(p.id)))
  }
  const baseline = await processes()
  const start = performance.now()
  await page.goto(`${preview.origin}/#/entity`)
  await page.locator(`[data-entity-count="${count}"]`).waitFor()
  const readinessMs = performance.now() - start
  assert.equal(
    await page.locator(`[data-entity-count="${count}"]`).getAttribute("data-id-bytes"),
    String(count * 16),
  )
  const sequence = await readEntityIds(backend.client)
  const navigation = []
  const grid = page.getByRole("grid", { name: "Entities" })
  for (const [position, key] of [
    [0, "Control+Home"],
    [count - 1, "Control+End"],
  ] as const) {
    const started = performance.now()
    await grid.focus()
    await page.keyboard.press(key)
    const expected = sequence.at(position)
    await page.locator(`[role="gridcell"][aria-selected="true"][id$="${expected}"]`).waitFor()
    await page.keyboard.press("Enter")
    await page.locator(`[data-entity-id="${expected}"]`).waitFor()
    await page.keyboard.press("Escape")
    await grid.waitFor()
    assert.equal(
      await grid.getAttribute("aria-activedescendant"),
      await page.locator('[role="gridcell"][aria-selected="true"]').getAttribute("id"),
    )
    navigation.push({ position, elapsedMs: performance.now() - started })
  }
  for (const viewport of [
    { width: 720, height: 480 },
    { width: 1200, height: 800 },
  ]) {
    await page.setViewportSize(viewport)
    await page.waitForFunction(() => {
      const grid = document.querySelector('[role="grid"]')!
      const selected = grid.querySelector('[role="gridcell"][aria-selected="true"]')
      if (!selected) return false
      const cell = selected.getBoundingClientRect(),
        bounds = grid.getBoundingClientRect()
      return (
        cell.top >= bounds.top &&
        cell.bottom <= bounds.bottom + 1 &&
        cell.left >= bounds.left &&
        cell.right <= bounds.right + 1
      )
    })
    assert.equal(
      await grid.getAttribute("aria-activedescendant"),
      await page.locator('[role="gridcell"][aria-selected="true"]').getAttribute("id"),
      "resizing retains the selected identity and keyboard anchor",
    )
  }
  await grid.evaluate((element) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
  })
  await page.waitForFunction(() => {
    const grid = document.querySelector('[role="grid"]')!
    const total = Number(grid.getAttribute("aria-rowcount"))
    return [...document.querySelectorAll('[role="row"][aria-rowindex]')].some((row) => {
      const position = Number(row.getAttribute("aria-rowindex")),
        box = row.getBoundingClientRect()
      return position > total * 0.4 && position < total * 0.6 && box.top > 80 && box.bottom < innerHeight
    })
  })
  const visible = await page.getByRole("gridcell").evaluateAll((cells) =>
    cells
      .filter((cell) => {
        const box = cell.getBoundingClientRect()
        return box.top > 80 && box.bottom < innerHeight
      })
      .map((cell) => cell.id),
  )
  assert(visible.length > 0)
  const middleCell = page.locator(`[id="${visible[Math.floor(visible.length / 2)]}"]`)
  await middleCell.dblclick()
  await page.locator('[data-slot="entity-inspection"]').waitFor()
  await page.keyboard.press("Escape")
  await grid.waitFor()
  const caches = await page.locator('section[aria-label="Entity"]').evaluate((element) => ({
    metadata: Number(element.getAttribute("data-metadata-cache")),
    preferences: Number(element.getAttribute("data-preference-cache")),
    pending: Number(element.getAttribute("data-pending-metadata")),
  }))
  assert(caches.metadata <= 256)
  assert(caches.preferences <= 256)
  assert((await page.getByRole("gridcell").count()) < 150)
  const physicalHeight = await grid.evaluate((element) => element.scrollHeight)
  assert(physicalHeight <= 8_000_001)
  const rendererMemory = await processes()
  // Keep the basic enumeration measurements above; now establish an equally
  // complete structured result through the actual renderer and checked transfer.
  const deadline = Date.now() + 600000
  while (true) {
    const status = (await backend.client.GET("/api/v1/search/status")).data!
    if (status.usable && status.covered_sequence === status.journal_head) break
    assert(Date.now() < deadline, `Search preparation did not complete: ${JSON.stringify(status)}`)
    await delay(500)
  }
  const filterStarted = performance.now()
  await page.getByRole("button", { name: /^Filter/ }).click()
  const filter = page.getByRole("dialog", { name: "Filter Entities" })
  await filter.getByRole("textbox", { name: "Filter source", exact: true }).fill("entity_id:*")
  await filter.getByRole("button", { name: "Apply", exact: true }).click()
  await filter.waitFor({ state: "hidden", timeout: 600000 })
  await page.locator(`[data-entity-count="${count}"]`).waitFor()
  assert.equal(await page.locator("[data-id-bytes]").getAttribute("data-id-bytes"), String(count * 16))
  const structuredNavigation = []
  for (const [position, key] of [
    [0, "Control+Home"],
    [count - 1, "Control+End"],
  ] as const) {
    const started = performance.now()
    await grid.focus()
    await page.keyboard.press(key)
    const expected = sequence.at(position)
    await page.locator(`[role="gridcell"][aria-selected="true"][id$="${expected}"]`).waitFor()
    await page.keyboard.press("Enter")
    await page.locator(`[data-entity-id="${expected}"]`).waitFor()
    await page.keyboard.press("Escape")
    await grid.waitFor()
    const visible = await page.locator('[role="gridcell"][aria-selected="true"]').evaluate((element) => {
      const box = element.getBoundingClientRect(),
        grid = element.closest('[role="grid"]')!.getBoundingClientRect()
      return box.top >= grid.top && box.bottom <= grid.bottom + 1
    })
    assert(visible, "Structured result restores selected viewport")
    structuredNavigation.push({
      position,
      elapsedMs: performance.now() - started,
    })
  }
  const structuredCache = await page.locator('section[aria-label="Entity"]').evaluate((element) => ({
    metadata: Number(element.getAttribute("data-metadata-cache")),
    pending: Number(element.getAttribute("data-pending-metadata")),
  }))
  assert(structuredCache.metadata <= 256)
  const structured = {
    count,
    byteLength: count * 16,
    elapsedMs: performance.now() - filterStarted,
    navigation: structuredNavigation,
    cache: structuredCache,
    memory: await processes(),
  }
  const heap = await page.evaluate(
    () =>
      (performance as any).memory?.toJSON?.() ?? {
        usedJSHeapSize: (performance as any).memory?.usedJSHeapSize,
      },
  )
  await page.screenshot({ path: join(output, "million-entity-grid.png") })
  const result = {
    passed: true,
    fixture: data.setup,
    idBytes: count * 16,
    readinessMs,
    navigation,
    physicalHeight,
    caches,
    baseline,
    rendererMemory,
    structured,
    heap,
    conditions: {
      os: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model,
      physicalMemory: totalmem(),
      browser: browser.version(),
      node: process.version,
      scope:
        "One headless Chromium renderer over an actual isolated SQLite Entity library; OS working-set high-water includes renderer startup. Memory fields overlap and must not be summed. No universal performance threshold.",
    },
  }
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ...result, output }, null, 2))
} finally {
  await browser.close()
  await preview.close()
  await data.dispose()
}

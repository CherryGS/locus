import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium } from "playwright"
import { readEntityIds, searchEntities, type LocusClient } from "@locus/client"
import type { Manifest, SampleCase, Wire } from "./sample-library-session.ts"

/** Reusable Tag fixtures over the actual comprehensive sample's retained Entities. */
export async function seedSampleTags(client: LocusClient, manifest: Manifest) {
  const vocabulary = await client.GET("/api/v1/tags")
  assert(vocabulary.data, JSON.stringify(vocabulary.error))
  const byName = new Map(vocabulary.data.map((tag) => [tag.name, tag]))
  const ensure = async (name: string, parent?: Wire<"TagRecord">) => {
    const existing = byName.get(name)
    if (existing) {
      assert.equal(existing.parent ?? null, parent?.id ?? null, "Sample Tag placement: " + name)
      return existing
    }
    const result = await client.POST("/api/v1/tags", {
      body: { request_id: randomUUID(), change: { operation: "create", name, parent: parent?.id } },
    })
    assert(result.data?.status === "tag_saved", JSON.stringify(result.error ?? result.data))
    byName.set(name, result.data.tag)
    return result.data.tag
  }
  const root = await ensure("Sample library")
  const other = await ensure("Sample / Other branch")
  const predicates: Record<string, (entry: SampleCase) => boolean> = {
    Files: (entry) => entry.view === "file.info",
    Images: (entry) => entry.result.kinds.some((kind) => kind.kind === "image" && !!kind.component_id),
    Videos: (entry) => entry.result.kinds.some((kind) => kind.kind === "video" && !!kind.component_id),
    Models: (entry) => ["model.read", "civitai.read"].includes(entry.view),
    Twitter: (entry) => entry.view === "twitter.read",
    Bilibili: (entry) => entry.view === "bilibili.read",
    Civitai: (entry) => entry.view === "civitai.read",
  }
  const groups = new Map<string, { tag: Wire<"TagRecord">; ids: Set<string> }>()
  const assign = async (tagId: string, entityId: string) => {
    const result = await client.POST("/api/v1/tags", {
      body: { request_id: randomUUID(), change: { operation: "add", tag_id: tagId, entity_id: entityId } },
    })
    assert.equal(result.data?.status, "tag_assignment", JSON.stringify(result.error ?? result.data))
  }
  for (const [name, predicate] of Object.entries(predicates)) {
    const tag = await ensure("Sample / " + name, root)
    const ids = new Set(manifest.cases.filter(predicate).map((entry) => entry.entityId))
    for (const id of ids) await assign(tag.id, id)
    groups.set(name, { tag, ids })
  }
  const empty = await ensure("Sample / Empty", root)
  await ensure("Sample / 中文 — café", root)
  const wide = await ensure("Sample / Wide branch", root)
  for (let i = 1; i <= 24; i++) await ensure(`Sample / Sibling ${String(i).padStart(2, "0")}`, wide)
  let deep = root
  for (let i = 1; i <= 8; i++)
    deep = await ensure(`Sample / Deep ${String(i).padStart(2, "0")} — 长路径`, deep)
  const directId = manifest.cases.find((entry) => entry.name === "image/landscape")!.entityId
  await assign(root.id, directId) // Also assigned to Images: inclusive queries must deduplicate it.
  const document = await client.GET("/api/v1/tags/{id}/document", { params: { path: { id: root.id } } })
  assert(document.data)
  if (!document.data.markdown) {
    const markdown = [
      "# Sample library", "", "中文描述 · café — a library of files, images, videos, models, and retained sources.", "",
      "## Browse the collection", "", "- Images and video covers", "- Twitter, Bilibili, and Civitai snapshots", "",
      "| Scope | Content |", "| --- | --- |", "| This tag | One directly assigned image |",
      "| Include descendants | All sample cases, without duplicates |", "",
      "> Descriptions and content selections belong to this tag.", "",
      "```text", "sample-library", "```", "",
    ].join("\n")
    const saved = await client.POST("/api/v1/tags", {
      body: { request_id: randomUUID(), change: {
        operation: "markdown", id: root.id, revision: document.data.tag.revision, markdown,
      } },
    })
    assert.equal(saved.data?.status, "tag_saved")
  }
  return { root, other, empty, wide, deep, groups }
}

export async function verifySampleTags(client: LocusClient, manifest: Manifest, origin: string, output: string) {
  const identitiesBefore = await readEntityIds(client)
  const sample = await seedSampleTags(client, manifest)
  assert.deepEqual(await readEntityIds(client), identitiesBefore, "Tag fixtures must not create Entities")
  const language = (await client.GET("/api/v1/filter/language")).data!
  const idsFor = async (id: string, inclusive = false) => {
    const result = await searchEntities(client, {
      format: language.format, version: language.version,
      text: `${inclusive ? "tag_subtree" : "tag_ids"}:"${id}"`,
    })
    return Array.from({ length: result.entities.length }, (_, i) => result.entities.at(i)!)
  }
  const all = new Set(manifest.cases.map((entry) => entry.entityId))
  const inclusive = await idsFor(sample.root.id, true)
  assert.equal(inclusive.length, all.size)
  assert.deepEqual(new Set(inclusive), all)
  assert.equal((await idsFor(sample.root.id)).length, 1)
  for (const group of sample.groups.values()) assert.deepEqual(new Set(await idsFor(group.tag.id)), group.ids)
  assert.deepEqual(await idsFor(sample.empty.id, true), [])
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors: string[] = [], remote: string[] = [], assertions: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (request) => { if (new URL(request.url()).origin !== origin) remote.push(request.url()) })
  const row = (name: string) => page.getByRole("treeitem", { name: `Select ${name}`, exact: true })
  const select = async (name: string) => {
    await page.getByLabel("Find tags", { exact: true }).fill(name)
    await page.getByRole("button", { name: `Reveal ${name}`, exact: true }).click()
    await row(name).waitFor()
    assert.equal(await row(name).getAttribute("aria-selected"), "true")
  }
  const enter = async (tag: Wire<"TagRecord">) => {
    await select(tag.name)
    await row(tag.name).press("Enter")
    await page.waitForURL(new RegExp(`#/tag/${tag.id}$`))
    await page.waitForFunction(() => {
      const edit = document.querySelector<HTMLButtonElement>('[aria-label="Edit description"]')
      return edit && !edit.disabled
    })
  }
  const back = async () => {
    await page.keyboard.press("Escape")
    await page.waitForURL(/#\/tags/)
  }
  const grid = page.getByRole("grid", { name: "Entities", exact: true })
  const selectedCell = page.getByRole("gridcell", { selected: true })
  const expectGrid = async (ids: Set<string>) => {
    await grid.waitFor()
    await grid.locator(`[data-entity-count="${ids.size}"]`).waitFor()
    await grid.press("ControlOrMeta+Home")
    const seen = new Set<string>()
    for (let i = 0; i < ids.size; i++) {
      const id = (await selectedCell.getAttribute("data-entity-id"))!
      assert(ids.has(id), "Unexpected grid Entity: " + id)
      assert(!seen.has(id), "Duplicate grid Entity: " + id)
      seen.add(id)
      await page.waitForFunction(() => document.querySelector('[role="gridcell"][aria-selected="true"]')?.getAttribute("aria-busy") === "false")
      await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('[role="gridcell"][aria-selected="true"] img')]
        .every((image) => image.complete && image.naturalWidth > 0))
      if (id === manifest.cases.find((entry) => entry.name === "image/landscape")!.entityId)
        assert.equal(await selectedCell.locator("img").count(), 1, "Managed image must render a decoded preview")
      assert.equal(await page.locator('[data-slot="entity-inspection"]').count(), 0)
      if (i + 1 < ids.size) await grid.press("ArrowRight")
    }
    assert.deepEqual(seen, ids)
  }
  try {
    await page.goto(origin + "/#/tags")
    await row(sample.root.name).waitFor()
    await row(sample.root.name).focus()
    await row(sample.root.name).press("Enter")
    assert.match(page.url(), /#\/tags/)
    await page.getByRole("region", { name: "Children of Sample library", exact: true }).waitFor()
    assert.equal(await row(sample.root.name).getByTitle("Direct children", { exact: true }).textContent(), "Children: 11")
    assert.equal(await row(sample.root.name).getByTitle("All descendants, excluding this tag", { exact: true }).textContent(), "Descendants: 42")
    const candidate = row(sample.other.name)
    await row(sample.root.name).press("ArrowUp")
    assert(await candidate.evaluate((element) => element === document.activeElement))
    await candidate.press("Enter")
    assert.match(page.url(), /#\/tags/)
    assert.equal(await candidate.getAttribute("aria-selected"), "true")
    assert.equal(await page.locator("[data-tag-column]").count(), 1)
    await candidate.press("Enter")
    await page.waitForURL(new RegExp(`#/tag/${sample.other.id}$`))
    await back()
    assertions.push("Unselected keyboard candidate locates first, then opens detail")
    await select(sample.deep.name)
    const columns = page.locator("[data-tag-column]")
    assert.equal(await columns.count(), 9)
    const scroll = page.getByLabel("Tag columns navigation", { exact: true })
    assert(await scroll.evaluate((element) => element.scrollLeft > 0))
    const branch = await columns.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-tag-column")))
    const path = page.getByRole("navigation", { name: "Tag path", exact: true })
    await path.getByRole("button", { name: "Locate Sample library", exact: true }).click()
    await row(sample.root.name).press("ArrowRight")
    await page.keyboard.press("ArrowLeft")
    assert.deepEqual(await columns.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-tag-column"))), branch)
    await select(sample.wide.name)
    await page.getByLabel(`Children navigation for ${sample.wide.name}`, { exact: true })
      .evaluate((element) => { element.scrollTop = element.scrollHeight })
    await row("Sample / Sibling 24").focus()
    await row("Sample / Sibling 24").press("Enter")
    assert.match(page.url(), /#\/tags/)
    assert.equal(await columns.count(), 3)
    await page.screenshot({ path: join(output, "tags-wide.png"), animations: "disabled" })
    assertions.push("Deep horizontal scroll, wide vertical scroll, counts, and noncollapsing breadcrumb/arrow location")
    await enter(sample.root)
    await page.getByRole("region", { name: "Tag document", exact: true }).getByRole("table").waitFor()
    await expectGrid(new Set(await idsFor(sample.root.id)))
    const historyLength = await page.evaluate(() => history.length)
    await page.getByRole("button", { name: "Include descendants", exact: true }).click()
    await expectGrid(all)
    assert.equal(await page.evaluate(() => history.length), historyLength)
    await page.screenshot({ path: join(output, "tags-all-content.png"), animations: "disabled" })
    const selectedBeforeInspect = (await selectedCell.getAttribute("data-entity-id"))!
    const scrollBeforeInspect = await grid.evaluate((element) => element.scrollTop)
    await selectedCell.dblclick()
    const inspection = page.locator('[data-slot="entity-inspection"]')
    await page.locator(`[data-slot="entity-inspection"][data-entity-id="${selectedBeforeInspect}"]`).waitFor()
    await page.getByRole("button", { name: "Next entity", exact: true }).click()
    await page.waitForFunction((previous) => document.querySelector('[data-slot="entity-inspection"]')?.getAttribute("data-entity-id") !== previous, selectedBeforeInspect)
    assert(all.has((await inspection.getAttribute("data-entity-id"))!))
    await page.getByRole("button", { name: "Previous entity", exact: true }).click()
    await page.locator(`[data-slot="entity-inspection"][data-entity-id="${selectedBeforeInspect}"]`).waitFor()
    await page.keyboard.press("Escape")
    await grid.waitFor()
    await page.waitForFunction((top) => Math.abs(document.querySelector('[role="grid"]')!.scrollTop - top) < 2, scrollBeforeInspect)
    assert.equal(await selectedCell.getAttribute("data-entity-id"), selectedBeforeInspect)
    assertions.push("Double-click inspection uses only Tag result neighbors; Esc restores grid selection and scroll")
    assertions.push(`Direct versus inclusive grid selects all ${all.size} retained sample cases once; single selection stays in the grid without history visits`)
    await page.getByRole("button", { name: "Edit description", exact: true }).click()
    const editor = page.locator('.tag-markdown .ProseMirror[contenteditable="true"]')
    await editor.waitFor()
    const retainedId = await selectedCell.getAttribute("data-entity-id")
    await editor.focus()
    await editor.press("ControlOrMeta+End")
    await page.keyboard.insertText("临时草稿 — discard this sample edit")
    await page.keyboard.press("ArrowRight")
    assert.equal(await selectedCell.getAttribute("data-entity-id"), retainedId)
    await selectedCell.dblclick()
    const inspectionLeave = page.getByRole("dialog", { name: "Unsaved description", exact: true })
    await inspectionLeave.waitFor()
    assert.equal(await inspection.count(), 0)
    await inspectionLeave.getByRole("button", { name: "Cancel", exact: true }).click()
    await inspectionLeave.waitFor({ state: "hidden" })
    await page.keyboard.press("Escape")
    const leave = page.getByRole("dialog", { name: "Unsaved description", exact: true })
    await leave.waitFor()
    await leave.getByRole("button", { name: "Cancel", exact: true }).click()
    await leave.waitFor({ state: "hidden" })
    await page.getByRole("group", { name: "Document actions", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click()
    await page.getByRole("button", { name: "Edit description", exact: true }).waitFor()
    assert.equal(await page.getByText("临时草稿 — discard this sample edit", { exact: true }).count(), 0)
    const frame = page.locator("[data-description-frame]")
    const before = (await frame.boundingBox())!
    const splitter = (await page.getByRole("separator", { name: "Resize description and grid", exact: true }).boundingBox())!
    await page.mouse.move(splitter.x + splitter.width / 2, splitter.y)
    await page.mouse.down()
    await page.mouse.move(splitter.x + splitter.width / 2, splitter.y + 60, { steps: 8 })
    await page.mouse.up()
    assert((await frame.boundingBox())!.height > before.height + 30)
    await page.setViewportSize({ width: 360, height: 800 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: join(output, "tags-narrow.png"), animations: "disabled" })
    await back()
    await enter(sample.empty)
    await page.getByText("No tagged content", { exact: true }).waitFor()
    await page.getByRole("button", { name: "Write description", exact: true }).click()
    await editor.waitFor()
    await page.getByRole("group", { name: "Document actions", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click()
    await page.getByText("No description yet", { exact: true }).waitFor()
    await back()
    await page.setViewportSize({ width: 1200, height: 800 })
    const displayCases: Record<string, string> = { Files: "file/document.txt", Images: "image/landscape",
      Videos: "video/landscape", Models: "model/local-unmatched", Twitter: "twitter/image-one",
      Bilibili: "bilibili/part-1", Civitai: "civitai/A" }
    for (const [name, group] of sample.groups) {
      await enter(group.tag)
      await expectGrid(group.ids)
      await page.screenshot({ path: join(output, `tags-${name.toLowerCase()}.png`), animations: "disabled" })
      await grid.press("ControlOrMeta+Home")
      const entry = manifest.cases.find((entry) => entry.name === displayCases[name])!
      await grid.locator(`[role="gridcell"][data-entity-id="${entry.entityId}"]`).dblclick()
      await page.locator(`[data-slot="entity-inspection"][data-entity-id="${entry.entityId}"][data-view-id="${entry.view}"]`).waitFor()
      if (name === "Images") await page.waitForFunction(() =>
        [...document.querySelectorAll<HTMLImageElement>('[data-slot="entity-inspection"] img')]
          .some((image) => image.complete && image.naturalWidth >= 960))
      if (name === "Videos" || name === "Bilibili")
        await page.locator('[data-slot="video-viewport"][data-state="ready"]').waitFor()
      if (name === "Files") await inspection.getByRole("heading", { name: `File ${entry.fileId}`, exact: true }).waitFor()
      if (name === "Models") {
        await inspection.getByRole("button", { name: /Read declarations/ }).click()
        await inspection.getByText("Local unmatched sample", { exact: true }).waitFor()
      }
      if (name === "Twitter") await inspection.getByText(
        "Offline field notes · three independently captured media items from the same post", { exact: true }).waitFor()
      if (name === "Civitai") await inspection.getByText("A independent model description", { exact: true }).waitFor()
      const tagSummary = page.getByRole("region", { name: "Personal tag summary", exact: true })
      assert.equal(await tagSummary.getAttribute("data-entity-id"), entry.entityId)
      assert((await tagSummary.boundingBox())!.height <= 36)
      await tagSummary.getByRole("button", { name: "Show personal tags", exact: true }).click()
      const tagPanel = page.getByRole("complementary", { name: "Overview", exact: true })
      await tagPanel.getByRole("button", { name: "Add tags", exact: true }).waitFor()
      assert.equal(await tagPanel.getByRole("textbox", { name: "Notes", exact: true }).count(), 1)
      await tagPanel.getByRole("button", { name: "Add tags", exact: true }).click()
      const tagDialog = page.getByRole("dialog", { name: "Tags", exact: true })
      await tagDialog.getByLabel("Find an existing tag", { exact: true }).waitFor()
      await page.keyboard.press("Escape")
      await tagDialog.waitFor({ state: "hidden" })
      assert(await tagPanel.getByRole("button", { name: "Add tags", exact: true }).evaluate((element) => element === document.activeElement))
      await page.getByRole("button", { name: "Overview", exact: true }).click()
      await page.screenshot({ path: join(output, `tags-${name.toLowerCase()}-inspect.png`), animations: "disabled" })
      await page.keyboard.press("Escape")
      await grid.waitFor()
      await back()
    }
    assertions.push("All seven grid groups and their saved content views, empty state, guarded inspection, Markdown draft guard, editor arrow isolation, splitter, and narrow layout")
    assertions.push("All seven presentation kinds and Tag context share compact personal tags, editable panel, and independent Add modal with focus return")
    assert.deepEqual(errors, [])
    assert.deepEqual(remote, [], "Tag grid and inspection must use managed local content")
    await writeFile(join(output, "tags.json"), JSON.stringify({ assertions, sampleCaseCount: all.size,
      root: sample.root.id, directCount: 1, inclusiveCount: inclusive.length,
      groups: Object.fromEntries([...sample.groups].map(([name, group]) => [name, group.ids.size])),
      errors, remoteRequests: remote,
    }, null, 2))
  } catch (error) {
    await page.screenshot({ path: join(output, "tags-failure.png") }).catch(() => {})
    throw error
  } finally {
    await browser.close()
  }
}

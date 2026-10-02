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
      "> Descriptions and gallery selections belong to this tag.", "",
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
  const figure = page.locator("[data-gallery-entity]")
  const gallery = page.getByRole("region", { name: "Associated content", exact: true })
  const position = gallery.getByRole("status", { name: "Gallery position", exact: true })
  const expectGallery = async (ids: Set<string>) => {
    await figure.waitFor()
    await position.getByText(new RegExp(` / ${ids.size}$`)).waitFor()
    // Scope changes retain a valid current Entity, which need not be the first result.
    const initialPosition = Number((await position.innerText()).split(" / ")[0])
    for (let i = initialPosition; i > 1; i--)
      await gallery.getByRole("button", { name: "Previous entity", exact: true }).click()
    await page.getByRole("button", { name: "Edit description", exact: true }).focus()
    const seen = new Set<string>()
    for (let i = 0; i < ids.size; i++) {
      const id = (await figure.getAttribute("data-gallery-entity"))!
      assert(ids.has(id), "Unexpected gallery Entity: " + id)
      assert(!seen.has(id), "Duplicate gallery Entity: " + id)
      seen.add(id)
      await page.waitForFunction(() => !document.querySelector('[aria-label="Reading entity"]'))
      await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('[data-gallery-entity] img')]
        .every((image) => image.complete && image.naturalWidth > 0))
      if (id === manifest.cases.find((entry) => entry.name === "image/landscape")!.entityId)
        assert.equal(await figure.locator("img").count(), 1, "Managed image must render a decoded preview")
      assert.equal(await page.locator('[data-slot="entity-inspection"]').count(), 0)
      if (i + 1 < ids.size) {
        await page.keyboard.press("ArrowRight")
        await position.getByText(`${i + 2} / ${ids.size}`, { exact: true }).waitFor()
      }
    }
    assert.deepEqual(seen, ids)
    assert(await gallery.getByRole("button", { name: "Next entity", exact: true }).isDisabled())
    for (let i = 1; i < ids.size; i++) await page.keyboard.press("ArrowLeft")
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
    await expectGallery(new Set(await idsFor(sample.root.id)))
    const historyLength = await page.evaluate(() => history.length)
    await page.getByRole("button", { name: "Include descendants", exact: true }).click()
    await expectGallery(all)
    assert.equal(await page.evaluate(() => history.length), historyLength)
    await page.screenshot({ path: join(output, "tags-all-content.png"), animations: "disabled" })
    assertions.push(`Direct versus inclusive gallery visits all ${all.size} retained sample cases once, without Entity inspection or history visits`)
    await page.getByRole("button", { name: "Edit description", exact: true }).click()
    const editor = page.locator('.tag-markdown .ProseMirror[contenteditable="true"]')
    await editor.waitFor()
    const retainedId = await figure.getAttribute("data-gallery-entity")
    await editor.focus()
    await editor.press("ControlOrMeta+End")
    await page.keyboard.insertText("临时草稿 — discard this sample edit")
    await page.keyboard.press("ArrowRight")
    assert.equal(await figure.getAttribute("data-gallery-entity"), retainedId)
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
    const splitter = (await page.getByRole("separator", { name: "Resize description and gallery", exact: true }).boundingBox())!
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
    for (const [name, group] of sample.groups) {
      await enter(group.tag)
      await expectGallery(group.ids)
      await page.screenshot({ path: join(output, `tags-${name.toLowerCase()}.png`), animations: "disabled" })
      await back()
    }
    assertions.push("All seven content groups, empty state, Markdown draft guard, editor arrow isolation, splitter, and narrow layout")
    assert.deepEqual(errors, [])
    assert.deepEqual(remote, [], "Tag gallery must use managed local content")
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

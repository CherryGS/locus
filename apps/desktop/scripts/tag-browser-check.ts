import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, type Page } from "playwright"
import { readEntityIds, searchEntities } from "@locus/client"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"
const data = await fixture(),
  backend = await data.start(),
  preview = await browserPreview(backend)
const output = await outputDirectory("tags"),
  browser = await chromium.launch({ headless: true })
let page: Page | undefined
try {
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  let enumerations = 0
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/v1/entities") enumerations++
  })
  await page.goto(`${preview.origin}/#/`)
  const manager = page.getByRole("complementary", { name: "Tag vocabulary", exact: true })
  const open = async () => {
    await page!
      .getByRole("link", { name: /^Tags/ })
      .first()
      .click()
    await manager.waitFor()
  }
  await open()
  await manager.getByText("No tags yet", { exact: true }).waitFor()
  const createDialog = page.getByRole("dialog", { name: "Create a tag", exact: true })
  const create = async (name: string, successful = true) => {
    if (!(await createDialog.isVisible())) await manager.getByRole("button", { name: "New tag", exact: true }).click()
    await createDialog.getByLabel("New tag name", { exact: true }).fill(name)
    await createDialog.getByRole("button", { name: "Create tag", exact: true }).click()
    if (successful) await createDialog.waitFor({ state: "hidden" })
  }
  await create("  cat  ")
  await manager.getByRole("button", { name: "Rename cat", exact: true }).waitFor()
  assert.equal((await readEntityIds(backend.client)).length, 4)
  await create("cat", false)
  await manager.getByText(/Not saved: A Tag already/).waitFor()
  assert.equal(await createDialog.getByLabel("New tag name", { exact: true }).inputValue(), "cat")
  await create("Cat")
  await manager.getByRole("button", { name: "Rename Cat", exact: true }).waitFor()
  await manager.getByText(/Not saved: A Tag already/).waitFor({ state: "hidden" })
  let vocabulary = (await backend.client.GET("/api/v1/tags")).data!
  const cat = vocabulary.find((t) => t.name === "cat")!,
    upper = vocabulary.find((t) => t.name === "Cat")!
  await page.screenshot({ path: join(output, "vocabulary.png") })
  await page.getByRole("link", { name: "Entity", exact: true }).click()
  await page.getByRole("link", { name: "Entity", exact: true }).click()
  await page.getByRole("gridcell").first().dblclick()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  const editor = page.getByRole("region", { name: "Personal tags", exact: true })
  await editor.getByText("No personal tags assigned.", { exact: true }).waitFor()
  const first = (await editor.getAttribute("data-entity-id"))!
  await editor.getByRole("button", { name: "Add cat", exact: true }).click()
  await editor.getByRole("button", { name: "Remove cat from this Entity", exact: true }).waitFor()
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  await editor.getByText("No personal tags assigned.", { exact: true }).waitFor()
  const second = (await editor.getAttribute("data-entity-id"))!
  assert.notEqual(first, second)
  await editor.getByRole("button", { name: "Add cat", exact: true }).click()
  await editor.getByRole("button", { name: "Remove cat from this Entity", exact: true }).waitFor()
  await editor.getByRole("button", { name: "Add Cat", exact: true }).click()
  await editor.getByRole("button", { name: "Remove Cat from this Entity", exact: true }).waitFor()
  await editor.getByRole("button", { name: "Remove Cat from this Entity", exact: true }).click()
  await editor.getByRole("button", { name: "Add Cat", exact: true }).waitFor()
  await editor.getByRole("button", { name: "Add Cat", exact: true }).click()
  await editor.getByRole("button", { name: "Remove Cat from this Entity", exact: true }).waitFor()
  const language = (await backend.client.GET("/api/v1/filter/language")).data!,
    catalogue = (await backend.client.GET("/api/v1/search/catalogue")).data!
  const names = catalogue.fields.find((f) => f.id === "tag_names")!,
    ids = catalogue.fields.find((f) => f.id === "tag_ids")!
  assert(names && ids)
  const query = async (text: string) =>
    (await searchEntities(backend.client, { format: language.format, version: language.version, text }))
      .entities
  assert.equal((await query(`${names.native_exact}:"cat"`)).length, 2)
  assert.equal((await query(`${names.native_exact}:"Cat"`)).length, 1)
  await page.screenshot({ path: join(output, "annotation.png") })
  await page
    .locator("header.title-bar")
    .getByRole("button", { name: "Return to source", exact: true })
    .click()
  // Keep an exact raw draft and an established identity result through global edits.
  const filter = page.getByRole("button", { name: /^Filter/ }),
    filterDialog = page.getByRole("dialog", { name: "Filter Entities" })
  await filter.click()
  const raw = 'tag_names_exact:"cat"  '
  await filterDialog.getByLabel("Filter source", { exact: true }).fill(raw)
  await filterDialog.getByRole("button", { name: "Apply", exact: true }).click()
  await filterDialog.waitFor({ state: "hidden" })
  const before = enumerations
  await open()
  // Tag results and return navigation have their own context, independent of the main Filter.
  await manager.getByRole("button", { name: "Browse cat", exact: true }).click()
  await page.getByRole("gridcell").nth(1).waitFor()
  assert.equal(await page.getByRole("gridcell").count(), 2)
  await page.getByRole("gridcell").first().dblclick()
  await page.getByRole("button", { name: "Overview", exact: true }).click()
  await editor.getByRole("button", { name: "Remove cat from this Entity", exact: true }).waitFor()
  const taggedFirst = (await editor.getAttribute("data-entity-id"))!
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  const taggedSecond = (await editor.getAttribute("data-entity-id"))!
  assert.deepEqual(new Set([taggedFirst, taggedSecond]), new Set([first, second]))
  await editor.getByRole("button", { name: "Remove cat from this Entity", exact: true }).click()
  await editor.getByRole("button", { name: "Add cat", exact: true }).waitFor()
  await page.getByText(/Tag assignments changed. This is the previous complete result/).waitFor()
  // Removal updates metadata but does not replace the current sequence or neighboring navigation.
  assert(await page.getByRole("button", { name: "Next entity", exact: true }).isEnabled())
  await page.locator("header.title-bar").getByRole("button", { name: "Return to source", exact: true }).click()
  assert.equal(await page.getByRole("gridcell").count(), 2)
  await page.getByRole("link", { name: "Home", exact: true }).click()
  await open()
  await page.getByRole("gridcell").nth(1).waitFor()
  assert(new URL(page.url()).hash.includes(cat.id))
  await page.getByRole("button", { name: "Refresh tag content", exact: true }).first().click()
  await page.getByRole("gridcell").nth(1).waitFor({ state: "hidden" })
  assert.equal(await page.getByRole("gridcell").count(), 1)
  assert.equal(await page.getByRole("gridcell", { selected: true }).count(), 0)
  await backend.client.POST("/api/v1/tags", { body: { request_id: crypto.randomUUID(), change: { operation: "add", entity_id: taggedSecond, tag_id: cat.id } } })
  await page.getByRole("button", { name: "Refresh tag content", exact: true }).click()
  await page.getByRole("gridcell").nth(1).waitFor()
  await page.route("**/api/v1/search/query", route => route.fulfill({ status: 500, json: { code: "operation_failed", message: "Isolated Tag search failure" } }))
  await page.getByRole("button", { name: "Refresh tag content", exact: true }).click()
  await page.getByText(/Tag content refresh failed: Isolated Tag search failure/).waitFor()
  assert.equal(await page.getByRole("gridcell").count(), 2)
  await page.unroute("**/api/v1/search/query")
  await page.getByRole("button", { name: "Refresh tag content", exact: true }).click()
  await page.getByText(/Tag content refresh failed:/).waitFor({ state: "hidden" })
  await create("unused")
  await manager.getByRole("button", { name: "Browse unused", exact: true }).click()
  await page.getByText("No tagged content", { exact: true }).waitFor()
  await manager.getByRole("button", { name: "Browse cat", exact: true }).click()
  await page.getByRole("gridcell").nth(1).waitFor()
  await page.screenshot({ path: join(output, "tag-content.png") })
  // A delayed complete result for one Tag cannot overwrite the newly selected Tag.
  await manager.getByRole("button", { name: "Browse unused", exact: true }).click()
  await page.getByText("No tagged content", { exact: true }).waitFor()
  let releaseTag!: () => void, seenTag!: () => void, deliveredTag!: () => void
  const heldTag = new Promise<void>(resolve => { releaseTag = resolve }), tagSeen = new Promise<void>(resolve => { seenTag = resolve })
  const tagDelivered = new Promise<void>(resolve => { deliveredTag = resolve })
  await page.route("**/api/v1/search/query", async route => {
    if (route.request().postDataJSON().text.includes(cat.id)) {
      const response = await route.fetch(); seenTag(); await heldTag; await route.fulfill({ response }); deliveredTag()
    } else await route.continue()
  })
  await manager.getByRole("button", { name: "Browse cat", exact: true }).click()
  await tagSeen
  await manager.getByRole("button", { name: "Browse Cat", exact: true }).click()
  await page.getByRole("gridcell").first().waitFor()
  releaseTag()
  await tagDelivered
  await page.unroute("**/api/v1/search/query")
  await page.getByRole("heading", { name: /^Cat/ }).waitFor()
  assert.equal(await page.getByRole("gridcell").count(), 1)
  await manager.getByRole("button", { name: "Browse cat", exact: true }).click()
  await page.getByRole("gridcell").nth(1).waitFor()
  await manager.getByRole("button", { name: "Rename cat", exact: true }).click()
  const rename = page.getByRole("dialog", { name: "Rename tag everywhere", exact: true })
  await rename.getByLabel("Tag name", { exact: true }).fill("kitten")
  let release!: () => void, received!: () => void
  const held = new Promise<void>((r) => (release = r)),
    seen = new Promise<void>((r) => (received = r))
  await page.route("**/api/v1/tags", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().change.operation === "rename"
    ) {
      const response = await route.fetch()
      received()
      await held
      await route.fulfill({ response })
    } else await route.continue()
  })
  await rename.getByRole("button", { name: "Save name", exact: true }).click()
  await seen
  assert(await rename.getByLabel("Tag name", { exact: true }).isDisabled())
  release()
  await rename.waitFor({ state: "hidden" })
  await page.unroute("**/api/v1/tags")
  await manager.getByRole("button", { name: "Rename kitten", exact: true }).waitFor()
  assert.equal((await query(`${ids.native_value}:"${cat.id}"`)).length, 2)
  assert.equal((await query(`${names.native_exact}:"cat"`)).length, 0)
  await page.getByRole("link", { name: "Entity", exact: true }).click()
  await filter.click()
  assert.equal(await filterDialog.getByLabel("Filter source", { exact: true }).inputValue(), raw)
  await page.keyboard.press("Escape")
  await filterDialog.waitFor({ state: "hidden" })
  assert.equal(enumerations, before)
  await open()
  await manager.getByRole("button", { name: "Delete kitten globally", exact: true }).click()
  const deletion = page.getByRole("dialog", { name: "Delete tag globally?", exact: true })
  await deletion.getByRole("button", { name: "Cancel", exact: true }).click()
  assert((await backend.client.GET("/api/v1/tags")).data!.some((t) => t.id === cat.id))
  await manager.getByRole("button", { name: "Delete kitten globally", exact: true }).click()
  await deletion.getByRole("button", { name: "Delete tag globally", exact: true }).click()
  await deletion.waitFor({ state: "hidden" })
  await manager.getByRole("button", { name: "Rename kitten", exact: true }).waitFor({ state: "hidden" })
  await page.getByText("Tag unavailable", { exact: true }).waitFor()
  assert.equal((await query(`${ids.native_value}:"${cat.id}"`)).length, 0)
  assert.equal((await readEntityIds(backend.client)).length, 4)
  for (const entity of [first, second])
    assert(
      !(
        await backend.client.GET("/api/v1/entities/{id}/tags", { params: { path: { id: entity } } })
      ).data!.tag_set!.tags.some((t) => t.id === cat.id),
    )
  // Failed reads retain observed vocabulary and offer an explicit reread.
  await page.route("**/api/v1/tags", async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill({
        status: 500,
        json: { code: "operation_failed", message: "Isolated Tag read failure" },
      })
    else await route.continue()
  })
  await manager.getByRole("button", { name: "Refresh vocabulary", exact: true }).click()
  await manager.getByText(/Vocabulary read failed: Isolated Tag read failure/).waitFor()
  await page.unroute("**/api/v1/tags")
  await manager.getByRole("button", { name: "Refresh vocabulary", exact: true }).click()
  await manager.getByText(/Vocabulary read failed:/).waitFor({ state: "hidden" })
  // A response lost after commit stays recoverable after closing and reopening.
  await page.route("**/api/v1/tags", async (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON().change.name === "lost") {
      await route.fetch()
      await route.abort("failed")
    } else await route.continue()
  })
  await create("lost", false)
  await createDialog.getByRole("button", { name: "Recover original request", exact: true }).waitFor()
  await createDialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await manager.getByRole("button", { name: "Recover original request", exact: true }).waitFor()
  await page.getByRole("link", { name: "Entity", exact: true }).click()
  await page.unroute("**/api/v1/tags")
  await open()
  await manager.getByRole("button", { name: "Recover original request", exact: true }).click()
  await manager
    .getByRole("button", { name: "Recover original request", exact: true })
    .waitFor({ state: "hidden" })
  vocabulary = (await backend.client.GET("/api/v1/tags")).data!
  assert.equal(vocabulary.filter((t) => t.name === "lost").length, 1)
  await create("   ", false)
  await manager.getByText(/Not saved: Tag name must not be blank/).waitFor()
  await createDialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.setViewportSize({ width: 640, height: 600 })
  await manager.evaluate(async el => { await Promise.allSettled(el.getAnimations().map(animation => animation.finished)) })
  await manager.getByRole("heading", { name: "Tags", exact: true }).scrollIntoViewIfNeeded()
  await writeFile(
    join(output, "small-layout.json"),
    JSON.stringify(
      await manager.evaluate((el) => ({
        bounds: el.getBoundingClientRect().toJSON(),
        display: getComputedStyle(el).display,
        maxHeight: getComputedStyle(el).maxHeight,
        scroll: el.scrollHeight,
        children: [...el.children].map((c) => ({
          tag: c.tagName,
          bounds: c.getBoundingClientRect().toJSON(),
        })),
      })),
      null,
      2,
    ),
  )
  const smallBounds = await manager.boundingBox()
  assert(
    smallBounds &&
      smallBounds.x >= 0 &&
      smallBounds.y >= 0 &&
      smallBounds.x + smallBounds.width <= 640 &&
      smallBounds.y + smallBounds.height <= 600,
  )
  await page.screenshot({ path: join(output, "small-vocabulary.png") })
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.getByRole("link", { name: "Entity", exact: true }).click()
  // Go to an unfiltered collection explicitly, then navigate during a delayed assignment response.
  await filter.click()
  await filterDialog.getByLabel("Filter source", { exact: true }).fill("entity_id:*")
  await filterDialog.getByRole("button", { name: "Apply", exact: true }).click()
  await filterDialog.waitFor({ state: "hidden" })
  await page.getByRole("gridcell").first().dblclick()
  if (!(await editor.isVisible()))
    await page.getByRole("button", { name: "Overview", exact: true }).click()
  await editor.getByRole("button", { name: "Add lost", exact: true }).waitFor()
  const old = (await editor.getAttribute("data-entity-id"))!
  const lost = vocabulary.find((t) => t.name === "lost")!
  let deliveredAdd!: () => void
  const delivered = new Promise<void>((r) => (deliveredAdd = r))
  let releaseAdd!: () => void, receivedAdd!: () => void
  const heldAdd = new Promise<void>((r) => (releaseAdd = r)),
    seenAdd = new Promise<void>((r) => (receivedAdd = r))
  await page.route("**/api/v1/tags", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON().change.operation === "add"
    ) {
      const response = await route.fetch()
      receivedAdd()
      await heldAdd
      await route.fulfill({ response })
      deliveredAdd()
    } else await route.continue()
  })
  await editor.getByRole("button", { name: "Add lost", exact: true }).click()
  await seenAdd
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  const current = (await editor.getAttribute("data-entity-id"))!
  assert.notEqual(current, old)
  releaseAdd()
  await delivered
  await page.unroute("**/api/v1/tags")
  await editor.getByRole("button", { name: "Add lost", exact: true }).waitFor()
  assert(
    (
      await backend.client.GET("/api/v1/entities/{id}/tags", { params: { path: { id: old } } })
    ).data!.tag_set!.tags.some((t) => t.id === lost.id),
  )
  assert(
    !(
      await backend.client.GET("/api/v1/entities/{id}/tags", { params: { path: { id: current } } })
    ).data!.tag_set?.tags.some((t) => t.id === lost.id),
  )
  assert.deepEqual(errors, [])
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        library: data.library,
        checks: [
          "empty vocabulary",
          "trimmed create",
          "duplicate and case-sensitive names",
          "separate vocabulary creation",
          "immediate add/remove",
          "exact and ID queries",
          "rename pending-input freeze",
          "raw draft and identity-result preservation",
          "global delete/cancel and entity retention",
          "failed read recovery",
          "lost committed response original recovery",
          "blank name correction",
          "pending-write navigation",
          "Tag-scoped detail neighbors and source return",
          "same-session Tag result restoration",
          "fixed membership after assignment removal and explicit refresh",
          "failed Tag refresh retains complete result",
          "unused Tag has a valid empty result",
          "superseded Tag query cannot overwrite newer selection",
          "deleting the active Tag keeps the page usable",
          "normal and small viewports",
        ],
        cat: cat.id,
        upper: upper.id,
      },
      null,
      2,
    ),
  )
  console.log(`PASS real Tag renderer. ${output}`)
} catch (e) {
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {})
  await writeFile(
    join(output, "failure.txt"),
    `${String(e)}\n${await page?.locator("body").innerText()}`,
  )
  throw e
} finally {
  await browser.close()
  await preview.close()
  await data.dispose()
}

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
  await page.goto(`${preview.origin}/#/`)
  const open = async () => {
    await page!.getByRole("link", { name: /^Tags/ }).first().click()
    await page!.getByRole("tree", { name: "Tag forest" }).waitFor()
  }
  await open()
  await page.getByText("No tags yet", { exact: true }).waitFor()
  const create = async (name: string, child = false) => {
    await page!
      .getByRole("button", { name: child ? "New child" : "New root tag", exact: true })
      .click()
    const dialog = page!.getByRole("dialog", { name: "Create a tag", exact: true })
    await dialog.getByLabel("Tag name", { exact: true }).fill(name)
    await dialog.getByRole("button", { name: "Create tag", exact: true }).click()
    await dialog.waitFor({ state: "hidden" })
  }
  const select = async (name: string) => {
    await page!.getByRole("treeitem", { name: `Select ${name}`, exact: true }).click()
    await page!.getByRole("heading", { name, exact: true }).waitFor()
  }
  await create("  Animals  ")
  await select("Animals")
  await create("Cat", true)
  await select("Cat")
  await create("Kitten", true)
  await create("Other")
  assert.equal((await readEntityIds(backend.client)).length, 4)
  await select("Animals")
  await page.getByRole("button", { name: "New child", exact: true }).click()
  let dialog = page.getByRole("dialog", { name: "Create a tag", exact: true })
  await dialog.getByLabel("Tag name", { exact: true }).fill("Cat")
  await dialog.getByRole("button", { name: "Create tag", exact: true }).click()
  await dialog.getByText(/already has this exact name/).waitFor()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  let tags = (await backend.client.GET("/api/v1/tags")).data!
  const animal = tags.find((t) => t.name === "Animals")!,
    cat = tags.find((t) => t.name === "Cat")!,
    kitten = tags.find((t) => t.name === "Kitten")!,
    other = tags.find((t) => t.name === "Other")!
  // A primary unused category can still find content carrying a descendant.
  const entity = (await readEntityIds(backend.client)).at(0)!
  const add = await backend.client.POST("/api/v1/tags", {
    body: {
      request_id: crypto.randomUUID(),
      change: { operation: "add", entity_id: entity, tag_id: kitten.id },
    },
  })
  assert.equal(add.data?.status, "tag_assignment")
  await page.getByLabel("Find tags", { exact: true }).fill("Kitten")
  await page.getByRole("treeitem", { name: "Select Animals", exact: true }).waitFor()
  await page.getByRole("treeitem", { name: "Select Cat", exact: true }).waitFor()
  await select("Kitten")
  await page.getByLabel("Find tags", { exact: true }).fill("nomatch")
  await page.getByText("No matching tags", { exact: true }).waitFor()
  await page.getByRole("heading", { name: "Kitten", exact: true }).waitFor()
  await page.getByRole("link", { name: "Entity", exact: true }).click()
  await open()
  assert.equal(await page.getByLabel("Find tags", { exact: true }).inputValue(), "nomatch")
  await page.getByRole("heading", { name: "Kitten", exact: true }).waitFor()
  await page.getByLabel("Find tags", { exact: true }).fill("")
  await select("Animals")
  // The tree owns focus and expansion independently from selection.
  await page.getByRole("button", { name: "Collapse Animals", exact: true }).click()
  const rootItem = page.getByRole("treeitem", { name: "Select Animals", exact: true })
  await rootItem.focus()
  await rootItem.press("ArrowRight")
  await rootItem.press("ArrowDown")
  const childItem = page.getByRole("treeitem", { name: "Select Cat", exact: true })
  assert(await childItem.evaluate((element) => element === document.activeElement))
  await childItem.press("Enter")
  await page.getByRole("heading", { name: "Cat", exact: true }).waitFor()
  await childItem.press("ArrowDown")
  const leafItem = page.getByRole("treeitem", { name: "Select Kitten", exact: true })
  await leafItem.press("Space")
  await page.getByRole("heading", { name: "Kitten", exact: true }).waitFor()
  await leafItem.press("Tab")
  assert(await page.evaluate(() => !document.activeElement?.closest('[role="tree"]')))
  await select("Animals")
  await page.screenshot({ path: join(output, "forest.png") })
  await page.getByRole("button", { name: "Include descendants", exact: true }).click()
  const filter = page.getByRole("dialog", { name: "Filter Entities", exact: true })
  await filter.waitFor()
  assert.equal(
    await filter.getByLabel("Filter source", { exact: true }).inputValue(),
    `tag_subtree:"${animal.id}"`,
  )
  // Root assistance reads full primary vocabulary, including the unused category.
  let observationRequests = 0
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/search/observation") observationRequests++
  })
  const filterSource = filter.getByLabel("Filter source", { exact: true })
  await filterSource.fill("")
  await filterSource.pressSequentially("@")
  await page.getByRole("button", { name: "Use field tag_subtree", exact: true }).click()
  const lookup = page.getByLabel("Find values with regex", { exact: true })
  await lookup.fill("[")
  await page.getByText(/Invalid regex:/).waitFor()
  await lookup.fill("^Animals$")
  const rootChoice = page.getByRole("button", { name: "Use value Animals", exact: true })
  await rootChoice.getByText(animal.id, { exact: true }).waitFor()
  assert(await rootChoice.getByText(animal.id, { exact: true }).isVisible())
  await page.screenshot({ path: join(output, "root-helper.png") })
  await rootChoice.click()
  await lookup.press("Enter")
  await page.waitForFunction(() => {
    const input = document.getElementById("filter-source") as HTMLTextAreaElement | null
    return input?.value.startsWith('tag_subtree:"')
  })
  assert.equal(await filterSource.inputValue(), `tag_subtree:"${animal.id}"`)
  assert.equal(observationRequests, 0)
  // Handoff leaves the previous main result intact until explicit Apply.
  await filter.getByRole("button", { name: "Apply", exact: true }).click()
  await filter.waitFor({ state: "hidden" })
  assert.equal(await page.getByRole("gridcell").count(), 1)
  await page.getByRole("button", { name: /^Filter/ }).click()
  await filter.getByLabel("Filter source", { exact: true }).fill('tag_names_exact:"retained draft"')
  await filter.getByRole("button", { name: "Close", exact: true }).click()
  await open()
  await select("Kitten")
  await page.getByRole("button", { name: "Exactly this tag", exact: true }).click()
  const guard = page.getByRole("dialog", { name: "Unsaved Filter edits", exact: true })
  await guard.waitFor()
  await guard.getByRole("button", { name: "Cancel", exact: true }).click()
  assert.equal(
    await filter.getByLabel("Filter source", { exact: true }).inputValue(),
    'tag_names_exact:"retained draft"',
  )
  await filter.getByRole("button", { name: "Close", exact: true }).click()
  await open()
  await page.getByRole("button", { name: "Exactly this tag", exact: true }).click()
  await guard.getByRole("button", { name: "Discard", exact: true }).click()
  assert.equal(
    await filter.getByLabel("Filter source", { exact: true }).inputValue(),
    `tag_ids:"${kitten.id}"`,
  )
  await filter.getByRole("button", { name: "Close", exact: true }).click()
  await open()
  await select("Cat")
  await page.getByRole("button", { name: "Move branch", exact: true }).click()
  dialog = page.getByRole("dialog", { name: "Move branch", exact: true })
  await dialog.getByLabel("Parent", { exact: true }).click()
  await page.getByRole("option", { name: "Other", exact: true }).click()
  await dialog.getByRole("button", { name: "Move branch", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  tags = (await backend.client.GET("/api/v1/tags")).data!
  assert.equal(tags.find((t) => t.id === cat.id)!.parent, other.id)
  assert.equal(tags.find((t) => t.id === kitten.id)!.parent, cat.id)
  const language = (await backend.client.GET("/api/v1/filter/language")).data!
  const query = async (text: string) =>
    (
      await searchEntities(backend.client, {
        format: language.format,
        version: language.version,
        text,
      })
    ).entities
  assert.equal((await query(`tag_subtree:"${animal.id}"`)).length, 0)
  assert.equal((await query(`tag_subtree:"${other.id}"`)).length, 1)
  await page.getByRole("button", { name: "Rename", exact: true }).click()
  dialog = page.getByRole("dialog", { name: "Rename tag everywhere", exact: true })
  await dialog.getByLabel("Tag name", { exact: true }).fill("Cats")
  await dialog.getByRole("button", { name: "Save name", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await page.getByRole("heading", { name: "Cats", exact: true }).waitFor()
  await page.getByRole("button", { name: "Delete tag", exact: true }).click()
  dialog = page.getByRole("dialog", { name: "Delete tag globally?", exact: true })
  await dialog.getByText(/immediate children move to Other/).waitFor()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("heading", { name: "Cats", exact: true }).waitFor()
  await page.getByRole("button", { name: "Delete tag", exact: true }).click()
  await dialog.getByRole("button", { name: "Delete tag globally", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await page.getByText("Choose a tag", { exact: true }).waitFor()
  tags = (await backend.client.GET("/api/v1/tags")).data!
  assert.equal(tags.find((t) => t.id === kitten.id)!.parent, other.id)
  assert.equal(
    (await backend.client.GET("/api/v1/entities/{id}/tags", { params: { path: { id: entity } } }))
      .data!.tag_set!.tags[0].id,
    kitten.id,
  )
  await page.getByLabel("Find tags", { exact: true }).fill("Kitten")
  await select("Kitten")
  // Reread failure retains the coherent forest and selected record, with a retry.
  await page.route("**/api/v1/tags", async (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          status: 500,
          json: { code: "operation_failed", message: "fixture read failure" },
        })
      : route.continue(),
  )
  await page.getByRole("button", { name: "Refresh vocabulary", exact: true }).click()
  await page.getByText(/Showing the previous forest/).waitFor()
  await page.getByRole("heading", { name: "Kitten", exact: true }).waitFor()
  await page.unroute("**/api/v1/tags")
  await page.getByRole("button", { name: "Refresh vocabulary", exact: true }).click()
  await page.getByText(/Showing the previous forest/).waitFor({ state: "hidden" })
  // A retained navigation position survives a reentry whose primary reread is delayed.
  for (let i = 0; i < 36; i++) {
    const result = await backend.client.POST("/api/v1/tags", {
      body: {
        request_id: crypto.randomUUID(),
        change: {
          operation: "create",
          name: `Scroll fixture ${String(i).padStart(2, "0")}`,
          parent: null,
        },
      },
    })
    assert.equal(result.data?.status, "tag_saved")
  }
  await page.getByLabel("Find tags", { exact: true }).fill("")
  const refreshed = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/v1/tags" && r.request().method() === "GET",
  )
  await page.getByRole("button", { name: "Refresh vocabulary", exact: true }).click()
  await refreshed
  await page.getByRole("treeitem", { name: "Select Scroll fixture 35", exact: true }).waitFor()
  const treeViewport = page.getByLabel("Tag tree navigation", { exact: true })
  await treeViewport.evaluate((element) => {
    element.scrollTop = 420
  })
  await page.waitForFunction(
    () => (document.querySelector('[aria-label="Tag tree navigation"]')?.scrollTop ?? 0) > 400,
  )
  await page.getByRole("link", { name: "Entity", exact: true }).click()
  let releaseRead!: () => void
  const heldRead = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  await page.route("**/api/v1/tags", async (route) => {
    if (route.request().method() === "GET") await heldRead
    await route.continue()
  })
  await open()
  assert((await treeViewport.evaluate((element) => element.scrollTop)) > 400)
  releaseRead()
  await page.getByRole("button", { name: "Refresh vocabulary", exact: true }).waitFor()
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>('[aria-label="Tags"] button')?.disabled,
  )
  assert((await treeViewport.evaluate((element) => element.scrollTop)) > 400)
  await page.unroute("**/api/v1/tags")
  await page.getByLabel("Find tags", { exact: true }).fill("Kitten")
  await page.setViewportSize({ width: 640, height: 780 })
  await page.screenshot({ path: join(output, "forest-narrow.png") })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        library: data.library,
        checks: [
          "forest create and uniqueness",
          "ancestor-preserving lookup",
          "navigation reentry",
          "guarded generated Filter draft waits Apply",
          "move and rename",
          "one-record delete promotion and direct annotations",
          "retained read failure",
          "narrow layout",
        ],
      },
      null,
      2,
    ),
  )
  console.log(`PASS real Tag forest renderer. ${output}`)
} catch (error) {
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {})
  await writeFile(
    join(output, "failure.txt"),
    `${String(error)}\n${await page?.locator("body").innerText()}`,
  )
  throw error
} finally {
  await browser.close()
  await preview.close()
  await data.dispose()
}

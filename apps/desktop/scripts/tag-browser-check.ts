import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, type Page } from "playwright"
import { readEntityIds, searchEntities, type components } from "@locus/client"
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
    await page!.getByRole("heading", { name: "Tags", exact: true }).waitFor()
  }
  await open()
  await page.getByText("No tags yet", { exact: true }).waitFor()
  const menuAction = async (action: string, target?: string) => {
    const row = target
      ? page!.getByRole("treeitem", { name: `Select ${target}`, exact: true })
      : page!.getByRole("treeitem", { selected: true })
    await row.click({ button: "right" })
    await page!.getByRole("menuitem", { name: action, exact: true }).click()
  }
  const create = async (name: string, child = false) => {
    if (child) await menuAction("New child")
    else await page!.getByRole("button", { name: "New root tag", exact: true }).click()
    const dialog = page!.getByRole("dialog", { name: "Create a tag", exact: true })
    await dialog.getByLabel("Tag name", { exact: true }).fill(name)
    await dialog.getByRole("button", { name: "Create tag", exact: true }).click()
    await dialog.waitFor({ state: "hidden" })
  }
  const select = async (name: string) => {
    const row = page!.getByRole("treeitem", {
      name: `Select ${name}`,
      exact: true,
    })
    if (await row.count()) await row.click()
    else {
      await page!.getByLabel("Find tags", { exact: true }).fill(name)
      await page!.getByRole("button", { name: `Reveal ${name}`, exact: true }).click()
    }
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
  await menuAction("New child")
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
  await page.getByText("Animals / Cat / Kitten", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Reveal Kitten", exact: true }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
  const searchRename = page.getByRole("dialog", { name: "Rename tag everywhere", exact: true })
  assert.equal(await searchRename.getByLabel("Tag name", { exact: true }).inputValue(), "Kitten")
  await searchRename.getByRole("button", { name: "Cancel", exact: true }).click()
  assert.equal(await page.getByLabel("Find tags", { exact: true }).inputValue(), "Kitten")
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
  // Sibling choices replace the branch; leaves never produce an empty column.
  const columns = page.locator("[data-tag-column]")
  const branchBeforeContext = await columns.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-tag-column")),
  )
  await menuAction("Rename", "Other")
  const renameProbe = page.getByRole("dialog", { name: "Rename tag everywhere", exact: true })
  assert.equal(await renameProbe.getByLabel("Tag name", { exact: true }).inputValue(), "Other")
  await renameProbe.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("heading", { name: "Animals", exact: true }).waitFor()
  assert.deepEqual(
    await columns.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-tag-column"))),
    branchBeforeContext,
  )
  const rootItem = page.getByRole("treeitem", {
    name: "Select Animals",
    exact: true,
  })
  assert.equal(
    await rootItem.getByTitle("Direct children", { exact: true }).textContent(),
    "Children: 1",
  )
  assert.equal(
    await rootItem.getByTitle("All descendants, excluding this tag", { exact: true }).textContent(),
    "Descendants: 2",
  )
  assert.equal(await columns.count(), 3)
  await select("Other")
  assert.equal(await columns.count(), 1)
  await select("Animals")
  await rootItem.focus()
  await rootItem.press("Shift+F10")
  await page.getByRole("menuitem", { name: "Rename", exact: true }).waitFor()
  await page.keyboard.press("Escape")
  await rootItem.press("ArrowRight")
  const childItem = page.getByRole("treeitem", {
    name: "Select Cat",
    exact: true,
  })
  assert(await childItem.evaluate((element) => element === document.activeElement))
  await childItem.press("Enter")
  await page.getByRole("heading", { name: "Cat", exact: true }).waitFor()
  assert.equal(await columns.count(), 3)
  await childItem.press("ArrowRight")
  const leafItem = page.getByRole("treeitem", {
    name: "Select Kitten",
    exact: true,
  })
  assert(await leafItem.evaluate((element) => element === document.activeElement))
  await leafItem.press("Space")
  await page.getByRole("heading", { name: "Kitten", exact: true }).waitFor()
  assert.equal(await columns.count(), 3)
  assert.equal(
    await leafItem.getByTitle("All descendants, excluding this tag", { exact: true }).textContent(),
    "Descendants: 0",
  )
  await leafItem.press("ArrowLeft")
  await page.getByRole("heading", { name: "Cat", exact: true }).waitFor()
  assert(await childItem.evaluate((element) => element === document.activeElement))
  assert.equal(await columns.count(), 3)
  await childItem.press("Tab")
  assert(await page.evaluate(() => !document.activeElement?.closest('[role="tree"]')))
  const historyLength = await page.evaluate(() => history.length),
    breadcrumbs = page.getByRole("navigation", { name: "Tag path", exact: true })
  await breadcrumbs.getByRole("button", { name: "Locate Animals", exact: true }).click()
  await page.getByRole("heading", { name: "Animals", exact: true }).waitFor()
  assert.equal(await columns.count(), 3)
  assert.equal(await breadcrumbs.getByRole("button").count(), 3)
  await rootItem.focus()
  await rootItem.press("ArrowRight")
  await page.getByRole("heading", { name: "Cat", exact: true }).waitFor()
  await childItem.press("ArrowRight")
  await page.getByRole("heading", { name: "Kitten", exact: true }).waitFor()
  await leafItem.press("ArrowLeft")
  await childItem.press("ArrowLeft")
  await page.getByRole("heading", { name: "Animals", exact: true }).waitFor()
  assert.equal(await columns.count(), 3)
  await breadcrumbs.getByRole("button", { name: "Locate Kitten", exact: true }).click()
  await page.getByRole("heading", { name: "Kitten", exact: true }).waitFor()
  assert.equal(await columns.count(), 3)
  assert.equal(await page.evaluate(() => history.length), historyLength)
  // Back leaves the Tag workflow rather than stepping through local selections.
  await page.goBack()
  await page.waitForURL(/#\/entity/)
  await page.goForward()
  await page.getByRole("heading", { name: "Kitten", exact: true }).waitFor()
  assert.equal(await columns.count(), 3)
  await page.screenshot({ path: join(output, "forest.png"), animations: "disabled" })
  await select("Animals")
  await page.getByRole("button", { name: "Find content", exact: true }).click()
  await page.getByRole("button", { name: "Include descendants", exact: true }).click()
  const filter = page.getByRole("dialog", {
    name: "Filter Entities",
    exact: true,
  })
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
  const rootChoice = page.getByRole("button", {
    name: "Use value Animals",
    exact: true,
  })
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
  await page.getByRole("button", { name: "Find content", exact: true }).click()
  await page.getByRole("button", { name: "Exactly this tag", exact: true }).click()
  const guard = page.getByRole("dialog", {
    name: "Unsaved Filter edits",
    exact: true,
  })
  await guard.waitFor()
  await guard.getByRole("button", { name: "Cancel", exact: true }).click()
  assert.equal(
    await filter.getByLabel("Filter source", { exact: true }).inputValue(),
    'tag_names_exact:"retained draft"',
  )
  await filter.getByRole("button", { name: "Close", exact: true }).click()
  await open()
  await page.getByRole("button", { name: "Find content", exact: true }).click()
  await page.getByRole("button", { name: "Exactly this tag", exact: true }).click()
  await guard.getByRole("button", { name: "Discard", exact: true }).click()
  assert.equal(
    await filter.getByLabel("Filter source", { exact: true }).inputValue(),
    `tag_ids:"${kitten.id}"`,
  )
  await filter.getByRole("button", { name: "Close", exact: true }).click()
  await open()
  await select("Cat")
  await menuAction("Move branch")
  dialog = page.getByRole("dialog", { name: "Move branch", exact: true })
  await dialog.getByLabel("Parent", { exact: true }).click()
  await page.getByRole("option", { name: "Other", exact: true }).click()
  await dialog.getByRole("button", { name: "Move branch", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  tags = (await backend.client.GET("/api/v1/tags")).data!
  assert.equal(tags.find((t) => t.id === cat.id)!.parent, other.id)
  assert.equal(tags.find((t) => t.id === kitten.id)!.parent, cat.id)
  await page.getByRole("region", { name: "Children of Other", exact: true }).waitFor()
  assert.equal(await columns.count(), 3)
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
  await menuAction("Rename")
  dialog = page.getByRole("dialog", {
    name: "Rename tag everywhere",
    exact: true,
  })
  await dialog.getByLabel("Tag name", { exact: true }).fill("Cats")
  await dialog.getByRole("button", { name: "Save name", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await page.getByRole("heading", { name: "Cats", exact: true }).waitFor()
  await menuAction("Delete tag")
  dialog = page.getByRole("dialog", {
    name: "Delete tag globally?",
    exact: true,
  })
  await dialog.getByText(/immediate children move to Other/).waitFor()
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("heading", { name: "Cats", exact: true }).waitFor()
  await menuAction("Delete tag")
  await dialog.getByRole("button", { name: "Delete tag globally", exact: true }).click()
  await dialog.waitFor({ state: "hidden" })
  await page.getByText("Choose a tag", { exact: true }).waitFor()
  tags = (await backend.client.GET("/api/v1/tags")).data!
  assert.equal(tags.find((t) => t.id === kitten.id)!.parent, other.id)
  assert.equal(
    (
      await backend.client.GET("/api/v1/entities/{id}/tags", {
        params: { path: { id: entity } },
      })
    ).data!.tag_set!.tags[0].id,
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
  await page
    .getByRole("treeitem", { name: "Select Kitten", exact: true })
    .click({ button: "right" })
  assert(await page.getByRole("menuitem", { name: "Rename", exact: true }).isDisabled())
  await page.keyboard.press("Escape")
  await page.unroute("**/api/v1/tags")
  await page.getByRole("button", { name: "Refresh vocabulary", exact: true }).click()
  await page.getByText(/Showing the previous forest/).waitFor({ state: "hidden" })
  // A retained navigation position survives a reentry whose primary reread is delayed.
  for (let i = 0; i < 36; i++) {
    for (const parent of [null, other.id]) {
      const result = await backend.client.POST("/api/v1/tags", {
        body: {
          request_id: crypto.randomUUID(),
          change: {
            operation: "create",
            name: `${parent ? "Child scroll" : "Scroll"} fixture ${String(i).padStart(2, "0")}`,
            parent,
          },
        },
      })
      assert.equal(result.data?.status, "tag_saved")
    }
  }
  await page.getByLabel("Find tags", { exact: true }).fill("")
  const refreshed = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/v1/tags" && r.request().method() === "GET",
  )
  await page.getByRole("button", { name: "Refresh vocabulary", exact: true }).click()
  await refreshed
  await page.getByRole("treeitem", { name: "Select Scroll fixture 35", exact: true }).waitFor()
  const treeViewport = page.getByLabel("Root tags navigation", { exact: true })
  await treeViewport.evaluate((element) => {
    element.scrollTop = 420
  })
  await page.waitForFunction(
    () => (document.querySelector('[aria-label="Root tags navigation"]')?.scrollTop ?? 0) > 400,
  )
  const childViewport = page.getByLabel("Children navigation for Other", { exact: true })
  await childViewport.evaluate((element) => {
    element.scrollTop = 320
  })
  await page.waitForFunction(
    () =>
      (document.querySelector('[aria-label="Children navigation for Other"]')?.scrollTop ?? 0) >
      300,
  )
  assert((await treeViewport.evaluate((element) => element.scrollTop)) > 400)
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
  assert((await childViewport.evaluate((element) => element.scrollTop)) > 300)
  releaseRead()
  await page.getByRole("button", { name: "Refresh vocabulary", exact: true }).waitFor()
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>('[aria-label="Tags"] button')?.disabled,
  )
  assert((await treeViewport.evaluate((element) => element.scrollTop)) > 400)
  assert((await childViewport.evaluate((element) => element.scrollTop)) > 300)
  await page.unroute("**/api/v1/tags")
  // Reveal an offscreen deep path and retain horizontal plus each column's scroll.
  let deepParent = other.id
  for (let i = 0; i < 8; i++) {
    const created = await backend.client.POST("/api/v1/tags", {
      body: {
        request_id: crypto.randomUUID(),
        change: { operation: "create", name: `Deep ${i}`, parent: deepParent },
      },
    })
    assert.equal(created.data?.status, "tag_saved")
    if (created.data?.status === "tag_saved") deepParent = created.data.tag.id
  }
  await page.getByRole("button", { name: "Refresh vocabulary", exact: true }).click()
  await page.getByLabel("Find tags", { exact: true }).fill("Deep 7")
  await page.getByRole("button", { name: "Reveal Deep 7", exact: true }).click()
  await page.getByRole("heading", { name: "Deep 7", exact: true }).waitFor()
  assert.equal(await columns.count(), 9)
  const horizontal = page.getByLabel("Tag columns navigation", { exact: true })
  assert((await horizontal.evaluate((e) => e.scrollLeft)) > 0)
  assert(
    await page.getByRole("treeitem", { name: "Select Deep 7", exact: true }).evaluate((row) => {
      const viewport = document
          .querySelector('[aria-label="Tag columns navigation"]')!
          .getBoundingClientRect(),
        box = row.getBoundingClientRect()
      return box.left >= viewport.left && box.right <= viewport.right
    }),
  )
  const horizontalPosition = await horizontal.evaluate((e) => e.scrollLeft)
  await breadcrumbs.getByRole("button", { name: "Locate Other", exact: true }).click()
  await page.getByRole("heading", { name: "Other", exact: true }).waitFor()
  assert.equal(await columns.count(), 9)
  assert.equal(await breadcrumbs.getByRole("button", { name: /^Locate / }).count(), 2)
  assert.equal(await horizontal.evaluate((e) => e.scrollLeft), 0)
  await breadcrumbs.getByRole("button", { name: "Show hidden path tags", exact: true }).click()
  const hiddenPath = page.getByRole("dialog", { name: "Hidden path tags", exact: true })
  await hiddenPath.getByRole("button", { name: "Locate Deep 3", exact: true }).click()
  await page.getByRole("heading", { name: "Deep 3", exact: true }).waitFor()
  assert.equal(await columns.count(), 9)
  assert.equal(await breadcrumbs.evaluate((node) => node.scrollWidth > node.clientWidth), false)
  await breadcrumbs.getByRole("button", { name: "Locate Deep 7", exact: true }).click()
  await page.getByRole("heading", { name: "Deep 7", exact: true }).waitFor()
  assert.equal(await columns.count(), 9)
  assert.equal(await horizontal.evaluate((e) => e.scrollLeft), horizontalPosition)
  await page.screenshot({ path: join(output, "forest-deep.png"), animations: "disabled" })
  await page.getByRole("link", { name: "Entity", exact: true }).click()
  await open()
  await horizontal.waitFor()
  assert.equal(await horizontal.evaluate((e) => e.scrollLeft), horizontalPosition)
  await page.getByLabel("Find tags", { exact: true }).fill("Kitten")
  await page.getByRole("button", { name: "Reveal Kitten", exact: true }).click()
  await page.getByRole("heading", { name: "Kitten", exact: true }).waitFor()
  await page.setViewportSize({ width: 640, height: 780 })
  await page.waitForFunction((id) => {
    const row = document.querySelector<HTMLElement>(`[data-tree-tag="${id}"]`)
    if (!row) return false
    const viewport = row.closest('[data-slot="scroll-area-viewport"]')!.getBoundingClientRect(),
      box = row.getBoundingClientRect()
    return box.top >= viewport.top && box.bottom <= viewport.bottom
  }, kitten.id)
  assert(
    await page
      .getByRole("button", { name: "Locate Kitten", exact: true })
      .evaluate((e) => e.clientWidth >= e.scrollWidth),
  )
  await page.screenshot({ path: join(output, "forest-narrow.png"), animations: "disabled" })
  // Short paths can still have long names: chips truncate without a horizontal scrollbar.
  let longParent: string | null = null
  const longNames = [
    "A very long root tag name for checking narrow navigation",
    "A very long child tag name for checking narrow navigation",
    "A very long leaf tag name for checking narrow navigation",
  ]
  for (const name of longNames) {
    const body: components["schemas"]["WriteTag"] = {
      request_id: crypto.randomUUID(),
      change: { operation: "create", name, parent: longParent },
    }
    const created = await backend.client.POST("/api/v1/tags", { body })
    assert.equal(created.data?.status, "tag_saved")
    if (created.data?.status === "tag_saved") longParent = created.data.tag.id
  }
  await page.getByRole("button", { name: "Refresh vocabulary", exact: true }).click()
  await page.getByLabel("Find tags", { exact: true }).fill(longNames[2])
  await page.getByRole("button", { name: `Reveal ${longNames[2]}`, exact: true }).click()
  await page.getByRole("heading", { name: longNames[2], exact: true }).waitFor()
  assert.equal(await breadcrumbs.evaluate((node) => node.scrollWidth > node.clientWidth), false)
  assert.equal(await breadcrumbs.evaluate((node) => getComputedStyle(node).overflowX), "hidden")
  await page.screenshot({ path: join(output, "path-long-names.png"), animations: "disabled" })
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
          "search path reveal",
          "single-path columns, counts, keyboard and navigation reentry",
          "guarded generated Filter draft waits Apply",
          "move and rename",
          "one-record delete promotion and direct annotations",
          "retained read failure",
          "row context menus and keyboard context entry",
          "collapsed clickable breadcrumb without horizontal overflow",
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

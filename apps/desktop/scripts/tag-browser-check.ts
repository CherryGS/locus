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
    if (await row.count()) {
      // A click on the already focused row now opens detail. This helper locates.
      await page!.getByLabel("Find tags", { exact: true }).focus()
      await row.click()
    }
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
  const allIds = await readEntityIds(backend.client)
  const entity = allIds.at(0)!
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
  const offPath = page.getByRole("treeitem", { name: "Select Other", exact: true })
  await offPath.focus()
  await offPath.press("ArrowRight")
  await page.getByRole("heading", { name: "Cat", exact: true }).waitFor()
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
  await childItem.press("Space")
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
  assert(await rootItem.evaluate((node) => node === document.activeElement))
  await page.keyboard.press("ArrowRight")
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
  const enterSelected = async (row: ReturnType<Page["getByRole"]>, id: string) => {
    await row.press("Enter")
    await page!.waitForURL(new RegExp(`#/tag/${id}$`))
    await page!.keyboard.press("Escape")
    await page!.waitForURL(/#\/tags/)
    assert.equal(await row.getAttribute("aria-selected"), "true")
    assert(await row.evaluate((node) => node === document.activeElement))
  }
  const listHistory = await page.evaluate(() => history.length)
  // DOM focus from Up/Down is a candidate, not the selected/open Tag.
  await rootItem.focus()
  await rootItem.press("ArrowDown")
  assert(await offPath.evaluate((node) => node === document.activeElement))
  assert.equal(await offPath.getAttribute("aria-selected"), "false")
  await offPath.press("Enter")
  await page.getByRole("heading", { name: "Other", exact: true }).waitFor()
  assert.match(page.url(), /#\/tags/)
  assert.equal(await columns.count(), 1)
  assert.equal(await page.evaluate(() => history.length), listHistory)
  await enterSelected(offPath, other.id)
  await offPath.press("ArrowUp")
  assert.equal(await rootItem.getAttribute("aria-selected"), "false")
  await page.keyboard.down("Enter")
  await page.getByRole("heading", { name: "Animals", exact: true }).waitFor()
  assert.equal(await rootItem.getAttribute("aria-expanded"), "true")
  assert.equal(await columns.count(), 2)
  await page.keyboard.down("Enter") // A held key must not turn selection into activation.
  await page.keyboard.up("Enter")
  assert.match(page.url(), /#\/tags/)
  await enterSelected(rootItem, animal.id)
  const candidateChild = page.getByRole("treeitem", { name: "Select Cat", exact: true })
  await candidateChild.focus()
  await candidateChild.press("Enter")
  await page.getByRole("heading", { name: "Cat", exact: true }).waitFor()
  assert.match(page.url(), /#\/tags/)
  assert.equal(await candidateChild.getAttribute("aria-expanded"), "true")
  assert.equal(await columns.count(), 3)
  await enterSelected(candidateChild, cat.id)
  const candidateLeaf = page.getByRole("treeitem", { name: "Select Kitten", exact: true })
  await candidateLeaf.focus()
  await candidateLeaf.press("Enter")
  await page.getByRole("heading", { name: "Kitten", exact: true }).waitFor()
  assert.match(page.url(), /#\/tags/)
  assert.equal(await candidateLeaf.getAttribute("aria-expanded"), null)
  assert.equal(await columns.count(), 3)
  await enterSelected(candidateLeaf, kitten.id)
  // Lookup Enter also locates first, then activates the selected forest row.
  await page.getByLabel("Find tags", { exact: true }).fill("Other")
  const lookupOther = page.getByRole("button", { name: "Reveal Other", exact: true })
  await lookupOther.focus()
  await lookupOther.press("Enter")
  await page.getByRole("heading", { name: "Other", exact: true }).waitFor()
  assert.match(page.url(), /#\/tags/)
  assert.equal(await page.getByLabel("Find tags", { exact: true }).inputValue(), "")
  await enterSelected(offPath, other.id)
  await page.getByLabel("Find tags", { exact: true }).fill("Other")
  await lookupOther.focus()
  await lookupOther.press("Enter")
  await page.waitForURL(new RegExp(`#/tag/${other.id}$`))
  await page.keyboard.press("Escape")
  await lookupOther.waitFor()
  assert.equal(await page.getByLabel("Find tags", { exact: true }).inputValue(), "Other")
  await page.getByLabel("Find tags", { exact: true }).fill("")
  await select("Kitten")
  await select("Animals")
  // A keyboard-focused but unselected row must not activate on its first click either.
  await offPath.focus()
  await offPath.click()
  await page.getByRole("heading", { name: "Other", exact: true }).waitFor()
  assert.match(page.url(), /#\/tags/)
  await select("Kitten")
  await select("Animals")
  // Detail has a complete independent Entity context, without replacing main Filter.
  await page.getByRole("link", { name: "Entity", exact: true }).click()
  await page.getByRole("button", { name: /^Filter/ }).click()
  const mainFilter = page.getByRole("dialog", { name: "Filter Entities", exact: true })
  const retainedMainSource = 'tag_names_exact:"Cat"'
  await mainFilter.getByLabel("Filter source", { exact: true }).fill(retainedMainSource)
  await mainFilter.getByRole("button", { name: "Apply", exact: true }).click()
  await mainFilter.waitFor({ state: "hidden" })
  await page.getByTestId("entity-grid-panel").getByText("No matches", { exact: true }).waitFor()
  await open()
  await select("Animals")
  const forestColumns = await columns.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-tag-column")))
  const readDocument = async () => {
    const result = await backend.client.GET("/api/v1/tags/{id}/document", { params: { path: { id: animal.id } } })
    assert(result.data, JSON.stringify(result.error))
    return result.data
  }
  const initialDocument = await readDocument()
  assert.equal(initialDocument.markdown, "")
  const markdown = "# Animals\n\n- Cats\n- Kittens\n\n| Kind | Note |\n| --- | --- |\n| Cat | Small |\n\n```text\ncat-code\n```\n"
  const seeded = await backend.client.POST("/api/v1/tags", { body: { request_id: crypto.randomUUID(),
    change: { operation: "markdown", id: animal.id, revision: initialDocument.tag.revision, markdown } } })
  assert.equal(seeded.data?.status, "tag_saved")
  const detail = page.getByRole("region", { name: "Tag detail", exact: true })
  const description = page.getByRole("region", { name: "Tag document", exact: true })
  const documentActions = page.getByRole("group", { name: "Document actions", exact: true })
  const editor = page.locator('.tag-markdown .ProseMirror[contenteditable="true"]')
  const enterDetail = async () => {
    await rootItem.focus()
    await rootItem.press("Enter")
    await page!.waitForURL(new RegExp(`#/tag/${animal.id}`))
    await documentActions.getByRole("button", { name: "Edit description", exact: true }).waitFor()
    await page!.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[aria-label="Document actions"] button')?.disabled)
  }
  const beginEdit = async () => {
    await documentActions.getByRole("button", { name: "Edit description", exact: true }).click()
    await editor.waitFor()
    await documentActions.getByRole("button", { name: "Save", exact: true }).waitFor({ state: "visible" })
    await page!.waitForFunction(() => !Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="Document actions"] button')).find((b) => b.textContent === "Save")?.disabled)
  }
  const append = async (text: string) => {
    await editor.focus()
    await editor.press("ControlOrMeta+End")
    await page!.keyboard.insertText(text)
  }
  const savedView = async () => {
    await documentActions.getByRole("button", { name: "Edit description", exact: true }).waitFor()
    await page!.locator('.tag-markdown .ProseMirror[contenteditable="false"]').waitFor()
  }
  const returnForest = async () => {
    await page!.keyboard.press("Escape")
    await page!.waitForURL(/#\/tags/)
    await rootItem.waitFor()
    assert.deepEqual(await columns.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-tag-column"))), forestColumns)
    assert(await rootItem.evaluate((node) => node === document.activeElement))
  }
  assert.match(page.url(), /#\/tags/)
  // First click locates; Enter on the focused row activates.
  await enterDetail()
  assert.equal(await detail.locator("header").count(), 1)
  assert.equal(await detail.locator("[data-slot=resizable-panel-group]").count(), 1)
  const toolbarBounds = await page.locator('[aria-label="Tag page tools"]').boundingBox()
  assert(toolbarBounds && toolbarBounds.height <= 48)
  const descriptionFrame = detail.locator("[data-description-frame]")
  assert.equal(await descriptionFrame.evaluate((element) => getComputedStyle(element).borderTopWidth), "1px")
  const frameBefore = await descriptionFrame.boundingBox()
  const splitter = detail.getByRole("separator", { name: "Resize description and grid", exact: true })
  const splitterBounds = await splitter.boundingBox()
  assert(frameBefore && splitterBounds)
  const splitterX = splitterBounds.x + splitterBounds.width / 2
  const splitterY = splitterBounds.y + splitterBounds.height / 2
  await page.mouse.move(splitterX, splitterY)
  await page.mouse.down()
  await page.mouse.move(splitterX, splitterY + 55, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction((height) => document.querySelector("[data-description-frame]")!.getBoundingClientRect().height > height + 30, frameBefore.height)
  await page.locator(".tag-markdown li").first().waitFor()
  await description.getByRole("table").waitFor()
  await page.locator(".tag-markdown").getByText("cat-code", { exact: true }).waitFor()
  await page.getByText("No tagged content", { exact: true }).waitFor()
  assert.equal(await page.getByRole("gridcell").count(), 0)
  await page.getByRole("button", { name: "Include descendants", exact: true }).click()
  await page.getByRole("gridcell").waitFor()
  assert.equal(await page.getByRole("gridcell").count(), 1)
  await page.route("**/api/v1/search/query", (route) => route.fulfill({
    status: 500, json: { code: "operation_failed", message: "fixture Tag query failure" },
  }))
  await page.getByRole("button", { name: "This tag", exact: true }).click()
  await page.getByText(/fixture Tag query failure/).waitFor()
  await page.getByText(/Showing the previous inclusive result/).waitFor()
  assert.equal(await page.getByRole("gridcell").count(), 1)
  await page.unroute("**/api/v1/search/query")
  await page.getByRole("button", { name: "Refresh tag page", exact: true }).click()
  await page.getByText("No tagged content", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Include descendants", exact: true }).click()
  await page.getByRole("gridcell").waitFor()
  assert.equal(await page.getByRole("gridcell", { selected: true }).getAttribute("data-entity-id"), entity)
  const grid = page.getByRole("grid", { name: "Entities", exact: true })
  await grid.waitFor()
  assert.equal(await grid.locator("[data-entity-count]").getAttribute("data-entity-count"), "1")
  const extraIds = [1, 2].map((index) => allIds.at(index)!)
  for (const id of extraIds) {
    const result = await backend.client.POST("/api/v1/tags", { body: { request_id: crypto.randomUUID(), change: { operation: "add", entity_id: id, tag_id: kitten.id } } })
    assert.equal(result.data?.status, "tag_assignment")
  }
  await page.getByRole("button", { name: "Refresh tag page", exact: true }).click()
  await grid.locator('[data-entity-count="3"]').waitFor()
  const detailUrl = page.url()
  const selectedEntity = () => page!.getByRole("gridcell", { selected: true }).getAttribute("data-entity-id")
  const cell = (id: string) => grid.locator(`[role="gridcell"][data-entity-id="${id}"]`)
  await cell(extraIds[0]).click()
  assert.equal(await selectedEntity(), extraIds[0])
  await grid.press("ArrowRight")
  assert.equal(await selectedEntity(), extraIds[1])
  await grid.press("ArrowLeft")
  assert.equal(await selectedEntity(), extraIds[0])
  assert.equal(page.url(), detailUrl)
  await cell(extraIds[0]).dblclick()
  await page.locator(`[data-slot="entity-inspection"][data-entity-id="${extraIds[0]}"]`).waitFor()
  assert.equal(await description.count(), 0)
  await page.getByRole("button", { name: "Next entity", exact: true }).click()
  await page.locator(`[data-slot="entity-inspection"][data-entity-id="${extraIds[1]}"]`).waitFor()
  await page.getByRole("button", { name: "Previous entity", exact: true }).click()
  await page.locator(`[data-slot="entity-inspection"][data-entity-id="${extraIds[0]}"]`).waitFor()
  await page.screenshot({ path: join(output, "tag-entity-inspect.png"), animations: "disabled" })
  await page.keyboard.press("Escape")
  await grid.waitFor()
  assert(await grid.evaluate((element) => element === document.activeElement))
  assert.equal(await selectedEntity(), extraIds[0])
  assert.equal(page.url(), detailUrl)
  await page.locator('[aria-label="Description area"]').evaluate((element) => { element.scrollTop = 0 })
  await page.screenshot({ path: join(output, "tag-grid.png"), animations: "disabled" })
  await page.setViewportSize({ width: 360, height: 800 })
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
  await page.screenshot({ path: join(output, "tag-grid-narrow.png"), animations: "disabled" })
  await page.setViewportSize({ width: 1200, height: 800 })
  await beginEdit()
  await append(" cursor-test")
  await editor.press("ArrowLeft")
  await editor.press("ArrowRight")
  assert.equal(await selectedEntity(), extraIds[0])
  await cell(extraIds[1]).dblclick()
  const inspectionGuard = page.getByRole("dialog", { name: "Unsaved description", exact: true })
  await inspectionGuard.waitFor()
  assert.equal(page.url(), detailUrl)
  await inspectionGuard.getByRole("button", { name: "Cancel", exact: true }).click()
  await inspectionGuard.waitFor({ state: "hidden" })
  await editor.getByText(/cursor-test/).waitFor()
  await documentActions.getByRole("button", { name: "Cancel", exact: true }).click()
  await savedView()
  await returnForest()
  await enterDetail()
  await savedView()
  assert.equal(await selectedEntity(), extraIds[1])
  for (const id of extraIds) await backend.client.POST("/api/v1/tags", { body: { request_id: crypto.randomUUID(), change: { operation: "remove", entity_id: id, tag_id: kitten.id } } })
  await page.getByRole("button", { name: "Refresh tag page", exact: true }).click()
  await grid.locator('[data-entity-count="1"]').waitFor()
  assert.equal(await selectedEntity(), entity)
  await beginEdit()
  await append(" 中文即时保存")
  // No debounce wait: Save must capture the live editor immediately.
  await documentActions.getByRole("button", { name: "Save", exact: true }).click()
  await savedView()
  const confirmedMarkdown = (await readDocument()).markdown
  assert(confirmedMarkdown.includes("中文即时保存"))
  assert.match(confirmedMarkdown, /\|\s*Kind\s*\|\s*Note\s*\|/)
  assert(confirmedMarkdown.includes("cat-code"))
  await page.route(`**/api/v1/tags/${animal.id}/document`, (route) => route.fulfill({
    status: 500, json: { code: "operation_failed", message: "fixture document read failure" },
  }))
  await page.getByRole("button", { name: "Refresh tag page", exact: true }).click()
  await description.getByText(/fixture document read failure/).waitFor()
  await page.locator(".tag-markdown").getByText(/中文即时保存/).waitFor()
  assert.equal(await page.getByRole("gridcell").count(), 1)
  await page.unroute(`**/api/v1/tags/${animal.id}/document`)
  await page.getByRole("button", { name: "Refresh tag page", exact: true }).click()
  await page.locator(".tag-markdown").getByText(/中文即时保存/).waitFor()
  await beginEdit()
  await editor.focus()
  await editor.press("ControlOrMeta+End")
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData("text/plain", " pasted-text")
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }))
  })
  await editor.getByText(/pasted-text/).waitFor()
  await editor.press("ControlOrMeta+z")
  await editor.getByText(/pasted-text/).waitFor({ state: "hidden" })
  await page.locator(".tag-markdown .ProseMirror > p").last().click()
  await editor.press("End")
  await editor.press("Enter")
  await page.keyboard.insertText("/")
  await page.locator('.milkdown-slash-menu[data-show="true"]').waitFor()
  await page.keyboard.press("Escape")
  await page.locator('.milkdown-slash-menu[data-show="true"]').waitFor({ state: "hidden" })
  assert.match(page.url(), /#\/tag\//)
  await append(" cancel-this")
  await page.screenshot({ path: join(output, "tag-detail-edit.png"), animations: "disabled" })
  await documentActions.getByRole("button", { name: "Cancel", exact: true }).click()
  await savedView()
  assert.equal((await readDocument()).markdown, confirmedMarkdown)
  assert.equal(await page.locator(".tag-markdown").getByText(/cancel-this/).count(), 0)
  const leaveGuard = page.getByRole("dialog", { name: "Unsaved description", exact: true })
  await beginEdit()
  await append(" discard-this")
  await page.keyboard.press("Escape")
  await leaveGuard.waitFor()
  await page.keyboard.press("Escape")
  await leaveGuard.waitFor({ state: "hidden" })
  assert.match(page.url(), /#\/tag\//)
  await editor.getByText(/discard-this/).waitFor()
  await detail.getByRole("button", { name: "Return to tags", exact: true }).click()
  await leaveGuard.getByRole("button", { name: "Discard", exact: true }).click()
  await page.waitForURL(/#\/tags/)
  assert.equal((await readDocument()).markdown, confirmedMarkdown)
  await enterDetail()
  await beginEdit()
  await append(" save-on-leave")
  await detail.getByRole("button", { name: "Return to tags", exact: true }).click()
  await leaveGuard.getByRole("button", { name: "Save", exact: true }).click()
  await page.waitForURL(/#\/tags/)
  assert((await readDocument()).markdown.includes("save-on-leave"))
  await enterDetail()
  await beginEdit()
  await append(" failed-save-draft")
  await page.route("**/api/v1/tags", async (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON()?.change?.operation === "markdown")
      await route.fulfill({ status: 400, json: { code: "invalid_request", message: "fixture rejected document" } })
    else await route.continue()
  })
  await documentActions.getByRole("button", { name: "Save", exact: true }).click()
  await description.getByText(/fixture rejected document/).waitFor()
  await editor.getByText(/failed-save-draft/).waitFor()
  await page.unroute("**/api/v1/tags")
  await description.getByRole("button", { name: "Use latest observation", exact: true }).click()
  await editor.getByText(/failed-save-draft/).waitFor()
  await documentActions.getByRole("button", { name: "Save", exact: true }).click()
  await savedView()
  assert((await readDocument()).markdown.includes("failed-save-draft"))
  await beginEdit()
  await append(" uncertain-save")
  let markdownSubmissions = 0
  await page.route("**/api/v1/tags", async (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON()?.change?.operation === "markdown") {
      markdownSubmissions++
      await route.fetch()
      await route.abort("failed")
    } else await route.continue()
  })
  await documentActions.getByRole("button", { name: "Save", exact: true }).click()
  await description.getByText(/Delivery unconfirmed/).waitFor()
  assert.equal(await documentActions.getByRole("button", { name: "Save", exact: true }).isDisabled(), true)
  assert.equal(await editor.count(), 0)
  await detail.getByRole("button", { name: "Return to tags", exact: true }).click()
  await leaveGuard.waitFor()
  assert.equal(await leaveGuard.getByRole("button", { name: "Discard", exact: true }).isDisabled(), true)
  await leaveGuard.getByRole("button", { name: "Cancel", exact: true }).click()
  await description.getByRole("button", { name: "Recover original request", exact: true }).click()
  await savedView()
  assert.equal(markdownSubmissions, 1)
  assert((await readDocument()).markdown.includes("uncertain-save"))
  await page.unroute("**/api/v1/tags")
  await page.screenshot({ path: join(output, "tag-detail.png"), animations: "disabled" })
  await returnForest()
  // A repeated click opens a focused row; repeatedly mount/unmount the imperative editor.
  for (let i = 0; i < 3; i++) {
    await rootItem.click()
    await page.waitForURL(new RegExp(`#/tag/${animal.id}`))
    await savedView()
    await returnForest()
  }
  await page.getByLabel("Find tags", { exact: true }).fill("Animals")
  const searchMatch = page.getByRole("button", { name: "Reveal Animals", exact: true })
  await searchMatch.focus()
  await searchMatch.press("Enter")
  await page.waitForURL(new RegExp(`#/tag/${animal.id}`))
  await savedView()
  await detail.getByRole("button", { name: "Return to tags", exact: true }).click()
  await page.waitForURL(/#\/tags/)
  assert.equal(await page.getByLabel("Find tags", { exact: true }).inputValue(), "Animals")
  assert(await searchMatch.evaluate((node) => node === document.activeElement))
  await searchMatch.click()
  await page.waitForURL(new RegExp(`#/tag/${animal.id}`))
  await savedView()
  await detail.getByRole("button", { name: "Return to tags", exact: true }).click()
  await page.waitForURL(/#\/tags/)
  assert.equal(await page.getByLabel("Find tags", { exact: true }).inputValue(), "Animals")
  assert(await searchMatch.evaluate((node) => node === document.activeElement))
  await page.getByLabel("Find tags", { exact: true }).fill("")
  await page.getByRole("link", { name: "Entity", exact: true }).click()
  await page.getByTestId("entity-grid-panel").getByText("No matches", { exact: true }).waitFor()
  await page.getByRole("button", { name: /^Filter/ }).click()
  assert.equal(await mainFilter.getByLabel("Filter source", { exact: true }).inputValue(), retainedMainSource)
  // Clear the unsaved authoring draft before the following generated-Filter checks.
  // The applied main result remains unchanged until their explicit Apply.
  await mainFilter.getByLabel("Filter source", { exact: true }).fill("")
  await mainFilter.getByRole("button", { name: "Close", exact: true }).click()
  await open()
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
  await hiddenPath.waitFor({ state: "hidden" })
  assert(
    await page
      .getByRole("treeitem", { name: "Select Deep 3", exact: true })
      .evaluate((node) => node === document.activeElement),
  )
  await page.keyboard.press("ArrowRight")
  await page.getByRole("heading", { name: "Deep 4", exact: true }).waitFor()
  assert.equal(await columns.count(), 9)
  assert.equal(await breadcrumbs.evaluate((node) => node.scrollWidth > node.clientWidth), false)
  await breadcrumbs.getByRole("button", { name: "Locate Deep 7", exact: true }).click()
  await page.getByRole("heading", { name: "Deep 7", exact: true }).waitFor()
  assert.equal(await columns.count(), 9)
  assert.equal(await horizontal.evaluate((e) => e.scrollLeft), horizontalPosition)
  await horizontal.focus()
  await horizontal.press("ArrowLeft")
  await page.getByRole("heading", { name: "Deep 6", exact: true }).waitFor()
  assert.equal(await columns.count(), 9)
  await horizontal.focus()
  await horizontal.press("ArrowRight")
  await page.getByRole("heading", { name: "Deep 7", exact: true }).waitFor()
  assert.equal(await columns.count(), 9)
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
          "candidate Enter selects/expands before detail; parent, leaf, lookup, held key and pointer parity",
          "guarded generated Filter draft waits Apply",
          "move and rename",
          "one-record delete promotion and direct annotations",
          "retained read failure",
          "row context menus and keyboard context entry",
          "collapsed clickable breadcrumb without horizontal overflow",
          "narrow layout",
          "focused Enter and repeated click detail activation with Esc forest restoration",
          "focused search match Enter and repeated click preserve lookup text and focus on return",
          "direct/inclusive Tag grid, double-click inspection, scoped neighbors, guarded editing and restored selection preserve main Filter",
          "Markdown list/table/code render, live Chinese save, reload, paste/undo and cancel",
          "dirty description Save/Discard/Cancel departures",
          "failed document draft retention and lost-response original-request recovery",
          "independent document read retry and qualified prior Entity scope after failed query",
          "imperative editor mount/unmount without page errors",
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

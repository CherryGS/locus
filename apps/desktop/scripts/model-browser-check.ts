import assert from "node:assert/strict"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { chromium } from "playwright"
import { modelFixture } from "./model-fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { outputDirectory } from "./fixture.ts"
const data = await modelFixture(),
  backend = await data.start(),
  preview = await browserPreview(backend)
const output = await outputDirectory("model-browser"),
  browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  })
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.goto(`${preview.origin}/#/entity`)
  await page.getByRole("gridcell").first().waitFor()
  const open = async (name: string) => {
    const entry = data.entries.find((e) => e.name === name)!
    await page.locator(`[role="gridcell"][id$="-${entry.entityId}"]`).dblclick()
    await page.locator('[data-slot="entity-inspection"][data-view-id="model.read"]').waitFor()
    if (!(await page.locator('#auxiliary-panel[aria-label="Overview"]').count()))
      await page.getByRole("button", { name: "Overview", exact: true }).click()
    return entry
  }
  const completeEntry = data.entries.find((e) => e.name === "complete")!
  const exact = await backend.client.GET("/api/v1/models/{component_id}/view", {
    params: { path: { component_id: completeEntry.componentId } },
  })
  assert.equal(exact.data?.record.facts?.tensors[2].shape[1], "9007199254740993")
  const entry = await open("complete")
  await page.getByRole("button", { name: /Read declarations/ }).click()
  await page.getByText("Synthetic weight sample", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Explore tensors", exact: true }).click()
  await page.getByRole("button", { name: /layer_00000.weight/ }).click()
  await page.getByText("[0, 64]", { exact: false }).waitFor()
  await page.screenshot({ path: join(output, "complete-tensor.png") })
  await page.getByRole("button", { name: "Use File view", exact: true }).click()
  await page.locator('[data-view-id="file.info"]').waitFor()
  await page.getByRole("button", { name: "Use Model view", exact: true }).click()
  await page.getByText("Choice saved", { exact: true }).waitFor()
  const preference = await backend.client.GET("/api/v1/entities/{entity_id}/view-preference", {
    params: { path: { entity_id: entry.entityId } },
  })
  assert(preference.data?.status === "saved" && preference.data.view_definition_id === "model.read")
  await page.getByRole("button", { name: /Read declarations/ }).click()
  await page.route(`**/models/${entry.componentId}/view`, (route) =>
    route.fulfill({
      status: 500,
      json: {
        code: "operation_failed",
        message: "Isolated Model read failure",
      },
    })
  )
  await page.getByRole("button", { name: "Reread Entity", exact: true }).click()
  await page.getByText("Isolated Model read failure", { exact: false }).waitFor()
  await page
    .getByText("Previous observation · the latest reread failed.", {
      exact: true,
    })
    .waitFor()
  assert(await page.getByText("Synthetic weight sample", { exact: true }).isVisible())
  await page.screenshot({ path: join(output, "retained-read-failure.png") })
  await page.unroute(`**/models/${entry.componentId}/view`)
  let releaseRead!:()=>void
  const heldRead=new Promise<void>(resolve=>{releaseRead=resolve})
  await page.route(`**/models/${entry.componentId}/view`,async route=>{await heldRead;await route.continue()})
  await page.getByRole("button",{name:"Reread Entity",exact:true}).first().click()
  await page.getByText("Previous observation · rereading metadata.",{exact:true}).waitFor()
  releaseRead()
  await page.getByText("Previous observation · rereading metadata.",{exact:true}).waitFor({state:"hidden"})
  await page.unroute(`**/models/${entry.componentId}/view`)

  await page.getByRole("button", { name: "Return to source", exact: true }).click()
  for (const name of [
    "metadata-absent",
    "metadata-empty",
    "uninspected",
    "first-failure",
    "retained-failure",
    "changed-input",
    "large",
  ]) {
    await open(name)
    if (name === "large") {
      await page.getByRole("button", { name: "Explore tensors", exact: true }).click()
      await page.locator('[data-slot="tensor-row"]').first().waitFor()
      const rows = await page.locator('[data-slot="tensor-row"]').count()
      assert(rows < 100)
      await writeFile(join(output, "large.json"), JSON.stringify({ descriptors: 10000, renderedRows: rows }))
    }
    await page.screenshot({ path: join(output, `${name}.png`) })
    await page.getByRole("button", { name: "Return to source", exact: true }).click()
  }
  assert.equal((await backend.client.GET("/api/v1/tasks")).data?.tasks.length, 0)
  // Actual import through the generated client, including failed candidate and same-item retry.
  const bad = join(data.root, "malformed-weight.bin"),
    good = join(data.root, "valid-weight.bin")
  const header = Buffer.from('{"scalar":{"dtype":"F32","shape":[],"data_offsets":[0,4]}}'),
    prefix = Buffer.alloc(8)
  prefix.writeBigUInt64LE(BigInt(header.length))
  await writeFile(good, Buffer.concat([prefix, header, Buffer.alloc(4)]))
  const broken = Buffer.from('{"broken":{}}'),
    bp = Buffer.alloc(8)
  bp.writeBigUInt64LE(BigInt(broken.length))
  await writeFile(bad, Buffer.concat([bp, broken]))
  const receipt = await backend.client.POST("/api/v1/import-batches", {
    body: { request_id: randomUUID(), source_paths: [good, bad] },
  })
  assert(receipt.data)
  const wait = async (task: string) => {
    for (let n = 0; n < 600; n++) {
      const r = await backend.client.GET("/api/v1/tasks/{task_id}/outcome", {
        params: { path: { task_id: task } },
      })
      if (r.data?.status === "complete") return
      await delay(50)
    }
    throw new Error("import did not end")
  }
  await wait(receipt.data.task_id)
  const snapshot = (await backend.client.GET("/api/v1/import-batches")).data!
  const batch = snapshot.batches[0]
  assert.equal(batch.items[0].current.complete, true)
  const failed = batch.items[1]
  assert.equal(failed.current.model.inspection.state, "failed")
  assert(failed.current.confirmed_entity_id)
  const value = await backend.client.GET("/api/v1/models/{component_id}/view", {
    params: {
      path: { component_id: batch.items[0].current.model.component_id! },
    },
  })
  assert.equal(value.data?.record.facts?.element_count, "1")
  await page.getByRole("button", { name: /^Tasks/ }).click()
  await page.locator("[data-task-record]").first().click()
  const goodRow=page.locator("article").filter({hasText:"valid-weight.bin"})
  await goodRow.getByText("Details",{exact:true}).click()
  await goodRow.getByText("inspection: success",{exact:true}).first().scrollIntoViewIfNeeded()
  await page.screenshot({path:join(output,"import-success-details.png")})
  await goodRow.getByText("Details",{exact:true}).click()
  const badRow = page.locator("article").filter({ hasText: "malformed-weight.bin" })
  await badRow.getByText("Details", { exact: true }).click()
  await badRow.getByText("inspection: failed", { exact: false }).first().waitFor()
  assert(await badRow.getByText("recognition: success", { exact: true }).first().isVisible())
  assert(await badRow.getByText("establishment: success", { exact: true }).first().isVisible())
  const modelGroup = badRow
    .locator("div")
    .filter({ has: page.locator("p.font-medium").filter({ hasText: /^Model/ }) })
    .last()
  assert(!/preview:/i.test(await modelGroup.innerText()), "Model has no preview stage")
  await modelGroup.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(output, "import-failure-details.png") })
  await badRow.getByRole("button", { name: "Complete processing", exact: true }).click()
  let retryTask: string | undefined
  for (let n = 0; n < 200; n++) {
    const tasks = (await backend.client.GET("/api/v1/tasks")).data?.tasks
    retryTask = tasks?.find((t) => t.operation.kind === "import_recovery")?.task_id
    if (retryTask) break
    await delay(25)
  }
  assert(retryTask)
  await wait(retryTask)
  await badRow.getByRole("button", { name: "View", exact: true }).click()
  await page
    .locator(
      `[data-slot="entity-inspection"][data-entity-id="${failed.current.confirmed_entity_id}"][data-view-id="model.read"]`
    )
    .waitFor()
  await page.getByText("No accepted inspection", { exact: true }).first().waitFor()
  await page.screenshot({ path: join(output, "import-failed-entry-view.png") })
  const retried = (await backend.client.GET("/api/v1/import-batches")).data!.batches[0].items[1]
  assert.equal(retried.current.model.component_id, failed.current.model.component_id)
  assert.equal(retried.current.file_id, failed.current.file_id)
  assert.deepEqual(errors, [])
  await writeFile(
    join(output, "results.json"),
    JSON.stringify(
      {
        errors,
        entries: data.entries,
        generatedClient: true,
        importSuccess: true,
        failedCandidateIdentity: failed.current.model.component_id,
        sameIdentityRetry: true,
      },
      null,
      2
    )
  )
  console.log(JSON.stringify({ output }))
} finally {
  await browser.close()
  await preview.close()
  await data.dispose()
}

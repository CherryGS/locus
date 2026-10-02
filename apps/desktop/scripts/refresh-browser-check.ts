import assert from "node:assert/strict"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { setTimeout as delay } from "node:timers/promises"
import { chromium, type Page } from "playwright"
import { fixture, outputDirectory } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"

const data = await fixture()
const backend = await data.start()
const preview = await browserPreview(backend)
const output = await outputDirectory("refresh-stability")
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const errors: string[] = []
page.on("pageerror", error => errors.push(error.message))
const held = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const samples: unknown[] = []
// Source strings avoid tsx's function-name helper in browser callbacks.
async function begin(page: Page, label: string, mode: "entity" | "tags" | "empty") {
  await page.evaluate(`(() => {
    const button=document.querySelector(${JSON.stringify(`button[aria-label="${label}"]`)});
    const root=document.querySelector(${JSON.stringify(mode === "entity" ? '[role="grid"]' : 'section[aria-label="Tags"]')});
    const nodes=[...root.querySelectorAll(${JSON.stringify(mode === "entity" ? '[role="gridcell"]' : '[role="treeitem"]')})];
    const images=[...root.querySelectorAll('img')].map(node=>({node,src:node.src}));
    const svg=button.querySelector('svg');
    const selected=()=>root.querySelector('[aria-selected="true"]')?.getAttribute(${JSON.stringify(mode === "entity" ? "data-entity-id" : "aria-label")});
    const selection=selected();
    const viewports=[...root.querySelectorAll('[data-slot="scroll-area-viewport"]'),...(root.matches('[data-slot="scroll-area-viewport"]')?[root]:[])].map(node=>({node,left:node.scrollLeft,top:node.scrollTop}));
    const result={frames:0,failures:[],removedImages:0,srcMutations:0,svgRemoved:0,running:true};
    const observer=new MutationObserver(records=>{for(const r of records){if(r.type==='attributes'&&r.attributeName==='src')result.srcMutations++;for(const n of r.removedNodes){if(n===svg)result.svgRemoved++;if(n.nodeType===1)result.removedImages+=(n.matches('img')?1:0)+n.querySelectorAll('img').length}}});
    observer.observe(document.getElementById('root'),{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
    const sample=()=>{if(!result.running)return;result.frames++;
      if(nodes.some(node=>!node.isConnected))result.failures.push('content node remounted');
      if(selected()!==selection)result.failures.push('selection changed');
      if(images.some(x=>!x.node.isConnected||x.node.src!==x.src))result.failures.push('image changed or disappeared');
      if(viewports.some(x=>x.node.isConnected&&(x.node.scrollLeft!==x.left||x.node.scrollTop!==x.top)))result.failures.push('scroll position changed');
      if(document.activeElement!==button)result.failures.push('refresh focus lost');
      if(getComputedStyle(button).opacity!=='1')result.failures.push('refresh control dimmed');
      if(${JSON.stringify(mode)}==='empty'&&button.getAttribute('aria-busy')==='true'&&!root.textContent.includes('No tags yet'))result.failures.push('established empty state replaced');
      requestAnimationFrame(sample)};
    window.refreshSample={result,observer,svg,button};requestAnimationFrame(sample);
  })()`)
}
async function finish(name: string) {
  const result = await page.evaluate(`(() => {const p=window.refreshSample;p.result.running=false;p.observer.disconnect();const result={...p.result,failures:[...new Set(p.result.failures)]};delete window.refreshSample;return result})()`) as {
    frames: number; failures: string[]; removedImages: number; srcMutations: number; svgRemoved: number
  }
  assert.deepEqual(result.failures, [], name)
  assert.equal(result.svgRemoved, 0, name)
  if (name.startsWith("entity")) {
    assert.equal(result.removedImages, 0, name)
    assert.equal(result.srcMutations, 0, name)
  }
  samples.push({ name, ...result })
}
try {
  for (const image of data.images) {
    const generated = await backend.client.POST("/api/v1/previews", { body: {
      request_id: crypto.randomUUID(), target: { kind: "image", component_id: image.componentId }, edge: 512,
    } })
    assert(generated.data)
    const deadline = Date.now() + 30_000
    for (;;) {
      assert(Date.now() < deadline, "Preview generation did not finish")
      const result = await backend.client.GET("/api/v1/tasks/{task_id}/outcome", {
        params: { path: { task_id: generated.data.task_id } },
      })
      if (result.data?.status === "complete") {
        assert.equal(result.data.outcome.status, "preview")
        break
      }
      await delay(10)
    }
  }
  await page.goto(`${preview.origin}/#/tags`)
  await page.getByText("No tags yet", { exact: true }).waitFor()
  const emptyGate = held(), emptyEntered = held()
  await page.route("**/api/v1/tags", async route => {
    emptyEntered.resolve(); await emptyGate.promise; await route.continue()
  })
  const tagRefresh = page.getByRole("button", { name: "Refresh vocabulary", exact: true })
  await tagRefresh.focus(); await begin(page, "Refresh vocabulary", "empty")
  await tagRefresh.click(); await emptyEntered.promise; await page.waitForTimeout(180)
  assert(await page.getByRole("button", { name: "New root tag", exact: true }).isEnabled())
  assert.equal(await tagRefresh.getAttribute("aria-disabled"), "true")
  emptyGate.resolve()
  await page.waitForFunction(() => document.querySelector('[aria-label="Refresh vocabulary"]')?.getAttribute("aria-busy") === "false")
  await finish("empty-tags-delayed")
  await page.unrouteAll({ behavior: "wait" })

  const createTag = async (name: string, parent?: string) => {
    const result = await backend.client.POST("/api/v1/tags", { body: {
      request_id: crypto.randomUUID(), change: { operation: "create", name, parent },
    } })
    assert(result.data?.status === "tag_saved")
    return result.data.tag.id
  }
  const root = await createTag("Refresh root")
  for (let i = 0; i < 35; i++) await createTag(`Item ${String(i).padStart(2, "0")}`, root)
  await tagRefresh.click()
  await page.getByRole("treeitem", { name: "Select Refresh root", exact: true }).click()
  await page.getByRole("treeitem", { name: "Select Item 25", exact: true }).click()
  await tagRefresh.focus(); await begin(page, "Refresh vocabulary", "tags")
  await tagRefresh.click()
  await page.waitForFunction(() => document.querySelector('[aria-label="Refresh vocabulary"]')?.getAttribute("aria-busy") === "false")
  await page.waitForTimeout(80); await finish("tags-fast")
  const tagGate = held(), tagEntered = held()
  let tagReads = 0
  await page.route("**/api/v1/tags", async route => {
    tagReads++; tagEntered.resolve(); await tagGate.promise; await route.continue()
  })
  await tagRefresh.focus(); await begin(page, "Refresh vocabulary", "tags")
  await tagRefresh.click(); await tagEntered.promise; await page.waitForTimeout(180)
  await tagRefresh.press("Space")
  assert.equal(tagReads, 1, "Busy refresh must not issue a duplicate request")
  tagGate.resolve()
  await page.waitForFunction(() => document.querySelector('[aria-label="Refresh vocabulary"]')?.getAttribute("aria-busy") === "false")
  await finish("tags-delayed")
  await page.unrouteAll({ behavior: "wait" })
  await page.route("**/api/v1/tags", route => route.fulfill({ status: 500,
    json: { code: "operation_failed", message: "isolated vocabulary read failed" } }))
  await tagRefresh.click()
  const failure = page.getByRole("alert").filter({ hasText: "isolated vocabulary read failed" })
  await failure.waitFor()
  await page.unrouteAll({ behavior: "wait" })
  const retryGate = held(), retryEntered = held()
  await page.route("**/api/v1/tags", async route => {
    retryEntered.resolve(); await retryGate.promise; await route.continue()
  })
  await tagRefresh.click(); await retryEntered.promise; await page.waitForTimeout(180)
  assert(await failure.isVisible(), "Retry must retain the qualified prior failure until success")
  retryGate.resolve(); await failure.waitFor({ state: "hidden" })
  await page.unrouteAll({ behavior: "wait" })

  await page.getByRole("link", { name: "Entity", exact: true }).click()
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('[role="grid"] img')] as HTMLImageElement[]
    return images.length === 3 && images.every(image => image.complete && image.naturalWidth > 0)
  })
  await page.locator(`[role="gridcell"][data-entity-id="${data.images[0].entityId}"]`).click()
  const entityRefresh = page.getByRole("button", { name: "Refresh library", exact: true })
  const idsGate = held(), idsEntered = held(), bytesGate = held(), bytesEntered = held()
  let idsReads = 0
  await page.route("**/api/v1/entities", async route => {
    idsReads++; idsEntered.resolve(); await idsGate.promise; await route.continue()
  })
  await page.route("**/api/v1/previews/*/bytes", async route => {
    bytesEntered.resolve(); await bytesGate.promise; await route.continue()
  })
  await entityRefresh.focus(); await begin(page, "Refresh library", "entity")
  await entityRefresh.click(); await idsEntered.promise; await page.waitForTimeout(180)
  await entityRefresh.press("Space")
  assert.equal(idsReads, 1)
  idsGate.resolve(); await bytesEntered.promise; await page.waitForTimeout(180)
  await page.screenshot({ path: join(output, "entity-refresh-pending.png") })
  bytesGate.resolve()
  await page.waitForFunction(() => [...document.querySelectorAll('[role="gridcell"]')].every(e => e.getAttribute("aria-busy") === "false"))
  await finish("entity-delayed")
  await page.unrouteAll({ behavior: "wait" })
  await entityRefresh.focus(); await begin(page, "Refresh library", "entity")
  await entityRefresh.click()
  await page.waitForFunction(() => document.querySelector('[aria-label="Refresh library"]')?.getAttribute("aria-busy") === "false" &&
    [...document.querySelectorAll('[role="gridcell"]')].every(e => e.getAttribute("aria-busy") === "false"))
  await page.waitForTimeout(80); await finish("entity-fast")
  await page.route("**/api/v1/previews/*/bytes", route => route.fulfill({ status: 500,
    json: { code: "operation_failed", message: "isolated preview read failed" } }))
  await entityRefresh.click()
  await page.getByRole("img", { name: "Entity has problems" }).first().waitFor()
  assert.equal(await page.locator('[role="grid"] img').count(), 3, "Failed reread retains the last qualified previews")
  await page.unrouteAll({ behavior: "wait" })
  const previewRetry = held(), previewRetryEntered = held()
  await page.route("**/api/v1/previews/*/bytes", async route => {
    previewRetryEntered.resolve(); await previewRetry.promise; await route.continue()
  })
  await entityRefresh.click(); await previewRetryEntered.promise; await page.waitForTimeout(180)
  assert.equal(await page.getByRole("img", { name: "Entity has problems" }).count(), 3,
    "Preview failures remain qualified while their resource retry is pending")
  previewRetry.resolve()
  await page.getByRole("img", { name: "Entity has problems" }).first().waitFor({ state: "hidden" })
  assert.equal(await page.locator('[role="grid"] img').count(), 3)
  assert.deepEqual(errors, [])
  await writeFile(join(output, "samples.json"), JSON.stringify(samples, null, 2))
  console.log(`PASS Stable refresh: fast/delayed Entity and Tags, empty forest, duplicate prevention, retained previews/focus/scroll and failure/retry. ${output}`)
} catch (error) {
  await page.screenshot({ path: join(output, "failure.png") }).catch(() => {})
  throw error
} finally {
  await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {})
  await browser.close()
  await preview.close()
  await data.dispose()
}

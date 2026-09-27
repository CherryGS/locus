import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { randomUUID } from "node:crypto"
import { rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { Page } from "playwright"
import type { components } from "@locus/client"
import { workspace, type startServer } from "./fixture.ts"

export async function registeredImportBrowser(page: Page, backend: Awaited<ReturnType<typeof startServer>>, library: string, sources: string, output: string) {
  const sql = (statement: string) => promisify(execFile)("uv", ["run", "python", "-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.commit()", join(library,"metadata.sqlite"), statement], {cwd:workspace, windowsHide:true})
  const source = join(sources,"registered-before-entry.txt")
  await writeFile(source,"same registered bytes")
  await sql("CREATE TRIGGER fail_import_entity BEFORE INSERT ON locus_core_comm_entity BEGIN SELECT RAISE(ABORT, 'fixture entry failure'); END;")
  await page.evaluate((path) => { (globalThis as any).__importSelections.push({ status:"selected", paths:[path] }) }, source)
  await page.getByRole("button",{name:"Import",exact:true}).click()
  await page.getByRole("button",{name:/^Tasks/}).click()
  const until = async (test:(value:components["schemas"]["ImportSnapshot"])=>boolean) => {
    const deadline=Date.now()+30000
    for (;;) { const value=await backend.client.GET("/api/v1/import-batches"); assert(value.data); if(test(value.data)) return value.data; assert(Date.now()<deadline,"import did not settle"); await delay(20) }
  }
  const failed=await until(s=>s.batches.some(b=>b.original_ended&&b.items.some(i=>i.source_path===source)))
  const batch=failed.batches.find(b=>b.items.some(i=>i.source_path===source))!
  const original=batch.items[0]
  assert(original.current.confirmed_file_id);assert.equal(original.current.confirmed_entity_id,null)
  assert.equal(original.current.overall,"failure");assert(!original.actions.includes("recopy"))
  await page.locator("[data-task-record]").filter({hasText:"1 need attention"}).last().click()
  const row=page.locator("article").filter({hasText:source})
  await row.getByText("File registered; entry incomplete",{exact:true}).waitFor()
  assert.equal(await row.getByRole("button",{name:"View",exact:true}).count(),0)
  assert.equal(await row.getByRole("button",{name:"Recopy source and import",exact:true}).count(),0)
  await row.getByText("Details",{exact:true}).click()
  await row.getByText(`Registered File: ${original.current.confirmed_file_id}`,{exact:true}).first().waitFor()
  await page.screenshot({path:join(output,"registered-file-no-entity.png")})
  await sql("DROP TRIGGER fail_import_entity;")
  await rename(source,`${source}.removed`)
  await row.getByRole("button",{name:"Complete processing",exact:true}).click()
  const recovered=await until(s=>!!s.batches.find(b=>b.batch_id===batch.batch_id)?.items[0].current.complete)
  const current=recovered.batches.find(b=>b.batch_id===batch.batch_id)!.items[0]
  assert.equal(current.current.confirmed_file_id,original.current.confirmed_file_id);assert.deepEqual(current.attempts[0],original.attempts[0])
  await row.getByRole("button",{name:"View",exact:true}).click()
  await page.locator(`[data-slot="entity-inspection"][data-entity-id="${current.current.confirmed_entity_id}"]`).waitFor()
  await page.getByRole("dialog",{name:"Tasks this run"}).waitFor({state:"hidden"})
  const receipt=await backend.client.POST("/api/v1/imports",{body:{request_id:randomUUID(),source_path:`${source}.removed`}});assert(receipt.data)
  const fileDeadline = AbortSignal.timeout(30000)
  let file=""
  while(!file){const r: { data?: components["schemas"]["OutcomeResponse"] }=await backend.client.GET("/api/v1/tasks/{task_id}/outcome",{params:{path:{task_id:receipt.data.task_id}},signal:fileDeadline}); if(r.data?.status==="complete"){assert.equal(r.data.outcome.status,"imported");if(r.data.outcome.status==="imported")file=r.data.outcome.file.file_id} if(!file)await delay(20,undefined,{signal:fileDeadline})}
  const request={request_id:randomUUID(),items:[{twitter:{post_id:"123456789"}},{file_id:file,twitter:{post_id:"123456789",text:"",hashtags:[]}}]}
  const response=await backend.client.POST("/api/v1/registered-import-batches",{body:request});assert(response.data)
  await until(s=>s.batches.some(b=>b.original_request_id===request.request_id&&b.original_ended))
  await page.getByRole("button",{name:/^Tasks/}).click()
  await page.locator("[data-task-record]").filter({hasText:"Import 2 items"}).click()
  await page.getByText("Twitter only",{exact:true}).waitFor();await page.getByText("Registered File + Twitter",{exact:true}).waitFor()
  const sourceRow=page.locator("article").filter({hasText:"Twitter only"})
  await sourceRow.getByText("Details",{exact:true}).click()
  await sourceRow.getByText("File registration: not requested",{exact:true}).first().waitFor()
  await sourceRow.getByText("Overall result: success",{exact:true}).first().waitFor()
  await page.screenshot({path:join(output,"registered-source-feedback.png")})
  await sourceRow.getByRole("button",{name:"View",exact:true}).click()
  await page.getByRole("dialog",{name:"Tasks this run"}).waitFor({state:"hidden"})
  await writeFile(join(output,"registered-results.json"),JSON.stringify({original,current,request,snapshot:(await backend.client.GET("/api/v1/import-batches")).data,picker:"Injected browser selection; not an OS picker check"},null,2))
}

import assert from "node:assert/strict"
import { workspaceLocation, activeWorkspacePage } from "./workspace-browser.ts"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { promisify } from "node:util"
import { setTimeout as delay } from "node:timers/promises"
import type { Page } from "playwright"
import { createLocusClient, ExternalAddressGroupId, uploadFile } from "@locus/client"
import type { startServer } from "./fixture.ts"
type Backend = Awaited<ReturnType<typeof startServer>>

export async function saveIsolatedExternalAddress(backend: Backend) {
  const socket = createServer().listen(0, "127.0.0.1")
  await once(socket, "listening")
  const address = socket.address()
  assert(address && typeof address !== "string")
  const value = `127.0.0.1:${address.port}`
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()))
  const saved = (await backend.client.GET("/api/v1/settings/groups/{group_id}", { params: { path: { group_id: ExternalAddressGroupId } } })).data
  assert(saved?.status === "current")
  const result = await backend.client.POST("/api/v1/settings/groups/{group_id}", { params: { path: { group_id: ExternalAddressGroupId } }, body: { request_id: randomUUID(), change: { operation: "update", expected_revision: saved.saved.metadata.revision, value: { address: value } } } })
  assert.equal(result.data?.status, "settings_saved")
}

export async function externalTaskBrowser(page: Page, backend: Backend, library: string) {
  const runtime = (await backend.client.GET("/api/v1/external-access/runtime")).data
  assert(runtime?.active_address)
  const observation = (await backend.client.GET("/api/v1/external-access/token")).data
  assert(observation?.status === "current")
  const context = { origin: `http://${runtime.active_address}`, runId: backend.context.runId }
  const transport: typeof fetch = (input, init) => { const request = new Request(input, init); request.headers.set("Authorization", `Bearer ${observation.token}`); return fetch(request) }
  const client = createLocusClient(context, transport)
  const sql = async (statement: string) => { await promisify(execFile)("uv", ["run", "python", "-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute(sys.argv[2]); c.commit(); c.close()", join(library, "metadata.sqlite"), statement], { windowsHide: true }) }
  const terminal = async (id: string) => {
    for (let count = 0; count < 1000; count++) { const value = (await client.GET("/external/v1/tasks/{task_id}/outcome", { params: { path: { task_id: id } } })).data; if (value?.status === "complete") return value.outcome; await delay(10) }
    throw Error("External task did not end")
  }
  const destination = await workspaceLocation(page)
  await sql("CREATE TRIGGER fixture_external_admission BEFORE INSERT ON locus_server_rela_access_eligibility BEGIN SELECT RAISE(ABORT,'fixture eligibility failure'); END")
  const uploadId = randomUUID()
  const submission = await uploadFile(context, { request_id: uploadId, byte_count: "5", filename: "browser-supplied.txt" }, new Blob(["bytes"]), transport)
  assert(submission.status === "accepted")
  const original = await terminal(submission.receipt.task_id)
  assert(original.status === "upload" && !original.result.confirmed_file_id && original.result.candidate_file_id)
  assert.equal(await workspaceLocation(page), destination)
  assert.equal(await page.getByRole("dialog", { name: "Tasks this run" }).isVisible(), false)
  await page.getByRole("button", { name: /^Tasks/ }).click()
  const dialog = page.getByRole("dialog", { name: "Tasks this run" })
  const entry = dialog.getByRole("button", { name: /Upload browser-supplied.txt/ })
  await entry.click()
  await dialog.getByText(/File admission incomplete/).first().waitFor()
  await sql("DROP TRIGGER fixture_external_admission")
  const recovered = await client.POST("/external/v1/upload-recoveries", { body: { request_id: randomUUID(), upload_id: uploadId, action: "retry" } })
  assert(recovered.data)
  const success = await terminal(recovered.data.task_id)
  assert(success.status === "upload" && success.result.confirmed_file_id === original.result.candidate_file_id)
  await dialog.getByText(/File registered.*ready for import/).first().waitFor()
  assert.equal(await entry.count(), 1, "original upload and recovery have one business record")
  await dialog.getByRole("heading", { name: "Recovery execution", exact: true }).waitFor()
  await dialog.getByRole("button", { name: "Close tasks", exact: true }).click()
  assert.equal(await workspaceLocation(page), destination)
  const requestId = randomUUID()
  await client.POST("/external/v1/import-batches", { body: { request_id: requestId, items: [{ file_id: success.result.confirmed_file_id, twitter: { post_id: "123456789" } }] } })
  for (;;) { const value = (await client.GET("/external/v1/requests/{request_id}", { params: { path: { request_id: requestId } } })).data; if (value?.status === "accepted") { await terminal(value.receipt.task_id); break } assert(value?.status !== "rejected"); await delay(10) }
  const batches = (await client.GET("/external/v1/import-batches")).data
  const batch = batches?.batches.find(b => b.original_request_id === requestId)
  const entity = batch?.items[0].current.confirmed_entity_id
  assert(entity)
  assert.equal(await workspaceLocation(page), destination, "external completion does not navigate")
  await page.getByRole("button", { name: /^Tasks/ }).click()
  await dialog.getByRole("button", { name: /Import 1 item/ }).click()
  await dialog.locator("[data-task-detail]:visible").getByRole("button", { name: "View", exact: true }).click()
  await activeWorkspacePage(page).locator(`[data-slot="entity-inspection"][data-entity-id="${entity}"]`).waitFor()
  await dialog.waitFor({ state: "hidden" })
  assert.equal(await dialog.isVisible(), false)
  return { uploadId, uploadTask: submission.receipt.task_id, recoveryTask: recovered.data.task_id, importRequest: requestId, entity }
}

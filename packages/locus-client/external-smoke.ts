import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createLocusClient, uploadFile, UploadDeliveryError, ExternalAddressGroupId, type components } from "./src/index.js";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "locus-external-smoke-"));
const binary = join(root, process.platform === "win32" ? "server.exe" : "server");
await copyFile(join(workspace, "target/debug", process.platform === "win32" ? "locus-server.exe" : "locus-server"), binary);
const library = join(root, "library");
async function start() {
  const credential = randomBytes(32).toString("hex");
  const process = spawn(binary, [], { stdio: "pipe", windowsHide: true });
  process.stderr.resume(); const exited = once(process, "exit");
  const lines = createInterface({ input: process.stdout });
  const next = once(lines, "line", { signal: AbortSignal.timeout(30_000) });
  process.stdin.end(JSON.stringify({ credential, library_root: library }));
  const [line] = await next; lines.close();
  const ready = JSON.parse(String(line)) as { origin: string; run_id: string };
  const transport: typeof fetch = (input, init) => { const request = new Request(input, init); request.headers.set("Authorization", `Bearer ${credential}`); return fetch(request); };
  const client = createLocusClient({ origin: ready.origin, runId: ready.run_id }, transport);
  return { process, exited, client, ready, async stop() { await client.POST("/api/v1/drain"); await exited; } };
}
let application = await start();
try {
  const port = createServer(); port.listen(0, "127.0.0.1"); await once(port, "listening");
  const address = port.address(); assert(address && typeof address !== "string"); const socket = `127.0.0.1:${address.port}`;
  await new Promise<void>((resolve, reject) => port.close(error => error ? reject(error) : resolve()));
  const saved = (await application.client.GET("/api/v1/settings/groups/{group_id}", { params: { path: { group_id: ExternalAddressGroupId } } })).data;
  assert(saved?.status === "current");
  const changed = await application.client.POST("/api/v1/settings/groups/{group_id}", { params: { path: { group_id: ExternalAddressGroupId } }, body: { request_id: randomUUID(), change: { operation: "update", expected_revision: saved.saved.metadata.revision, value: { address: socket } } } });
  assert.equal(changed.data?.status, "settings_saved"); await application.stop(); application = await start();
  const origin = `http://${socket}`;
  const bootstrap = await fetch(`${origin}/external/v1/bootstrap`).then(r => r.json()) as components["schemas"]["ExternalBootstrap"];
  assert.equal(bootstrap.run_id, application.ready.run_id);
  const local = (await application.client.GET("/api/v1/external-access/token")).data; assert(local?.status === "current");
  let token = local.token;
  const transport: typeof fetch = (input, init) => { const request = new Request(input, init); request.headers.set("Authorization", `Bearer ${token}`); return fetch(request); };
  let context = { origin, runId: bootstrap.run_id }; let client = createLocusClient(context, transport);
  const receipt = async (request: string) => {
    for (let count = 0; count < 1000; count++) {
      const value = (await client.GET("/external/v1/requests/{request_id}", { params: { path: { request_id: request } } })).data;
      if (value?.status === "accepted") return value.receipt;
      assert(value?.status !== "rejected", "External admission rejected"); await delay(5);
    }
    throw new Error("External admission timed out");
  };
  const finished = async (task: string) => {
    for (let count = 0; count < 1000; count++) {
      const value = (await client.GET("/external/v1/tasks/{task_id}/outcome", { params: { path: { task_id: task } } })).data;
      if (value?.status === "complete") return value.outcome;
      await delay(5);
    }
    throw new Error("External operation timed out");
  };
  const metadata = { request_id: randomUUID(), byte_count: "131073", filename: "supplied.bin" };
  const bytes = new Uint8Array(131073).fill(42);
  const submitted = await uploadFile(context, metadata, bytes, transport); assert.equal(submitted.status, "accepted");
  const admitted = await finished((await receipt(metadata.request_id)).task_id); assert(admitted.status === "upload" && admitted.result.confirmed_file_id);
  const file = admitted.result.confirmed_file_id;
  assert.deepEqual(await uploadFile(context, metadata, bytes, transport), submitted);
  bytes[0] = 43;
  await assert.rejects(uploadFile(context, metadata, bytes, transport), error => error instanceof UploadDeliveryError && error.detail.code === "request_conflict");
  const empty = { request_id: randomUUID(), byte_count: "0", filename: null };
  await uploadFile(context, empty, new Uint8Array(), transport); const emptyResult = await finished((await receipt(empty.request_id)).task_id); assert(emptyResult.status === "upload" && emptyResult.result.confirmed_file_id);
  const imports = (await application.client.GET("/api/v1/import-batches")).data; assert.equal(imports?.batches.length, 0);
  const reset = { request_id: randomUUID(), expected_revision: local.revision };
  assert.equal((await application.client.POST("/api/v1/external-access/token/reset", { body: reset })).data?.status, "token_reset");
  assert.equal((await client.GET("/external/v1/tasks")).response.status, 401);
  const current = (await application.client.GET("/api/v1/external-access/token")).data; assert(current?.status === "current"); token = current.token;
  assert.equal((await client.GET("/external/v1/requests/{request_id}", { params: { path: { request_id: metadata.request_id } } })).data?.status, "accepted");
  await application.stop(); application = await start();
  const reopened = (await application.client.GET("/api/v1/external-access/token")).data; assert(reopened?.status === "current"); assert(reopened.token === token);
  context = { origin, runId: application.ready.run_id }; client = createLocusClient(context, transport);
  assert.equal((await client.GET("/external/v1/requests/{request_id}", { params: { path: { request_id: metadata.request_id } } })).response.status, 404);
  const importRequest = { request_id: randomUUID(), items: [{ file_id: file, twitter: { post_id: "123456789", text: "Supplied observation" } }] };
  await client.POST("/external/v1/import-batches", { body: importRequest }); await finished((await receipt(importRequest.request_id)).task_id);
  const batches = (await client.GET("/external/v1/import-batches")).data; const batch = batches?.batches.find(b => b.original_request_id === importRequest.request_id);
  assert(batch?.items[0].current.confirmed_entity_id); assert.equal(batch.items[0].current.association.state, "success");
  // A request may deliberately equal another context's exposed business ID.
  const collision = { request_id: batch.batch_id, items: [{ twitter: { post_id: "987654321" } }] };
  await application.client.POST("/api/v1/registered-import-batches", { body: collision });
  for (let count = 0; count < 1000; count++) { const value = (await application.client.GET("/api/v1/requests/{request_id}", { params: { path: { request_id: collision.request_id } } })).data; if (value?.status === "accepted") break; await delay(5); }
  assert((await client.GET("/external/v1/import-batches")).data?.batches.some(b => b.batch_id === batch.batch_id));
  console.log("PASS external generated client: streamed-size upload, zero bytes, effective duplicate conflict, Token reset, retained eligibility after restart, intentional combined import and cross-namespace isolation.");
  await application.stop();
} finally {
  if (application.process.exitCode === null) { application.process.kill(); await application.exited; }
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { createLocusClient, type components } from "./src/index.js";
import { fixturePng } from "./smoke-png.js";
const workspace = fileURLToPath(new URL("../../", import.meta.url));
const root = await mkdtemp(join(tmpdir(), "locus-import-smoke-"));
const plain = join(root, "plain"), image = join(root, "image.bin"), missing = join(root, "not-yet-present");
await writeFile(plain, "ordinary file"); await writeFile(image, fixturePng(20, 10));
const credential = randomBytes(32).toString("hex");
const child = spawn(join(workspace, "target/debug", process.platform === "win32" ? "locus-server.exe" : "locus-server"), [], { stdio: "pipe", windowsHide: true });
const exited = once(child, "exit"); child.stderr.resume();
const lines = createInterface({ input: child.stdout }); const next = once(lines, "line", { signal: AbortSignal.timeout(30_000) });
child.stdin.end(JSON.stringify({ credential, library_root: join(root, "library") }));
const [line] = await next; lines.close();
const ready = JSON.parse(String(line)) as { origin: string; run_id: string };
const transport: typeof fetch = (input, init) => { const r = new Request(input, init); r.headers.set("Authorization", `Bearer ${credential}`); return fetch(r); };
const client = createLocusClient({ origin: ready.origin, runId: ready.run_id }, transport);
const deadline = AbortSignal.timeout(30_000);
async function snapshot() { const r = await client.GET("/api/v1/import-batches", { signal: deadline }); assert(r.data, JSON.stringify(r.error)); return r.data; }
async function until(done: (s: components["schemas"]["ImportSnapshot"]) => boolean) { for (;;) { const s = await snapshot(); if (done(s)) return s; await delay(10, undefined, { signal: deadline }); } }
try {
  const body = { request_id: randomUUID(), source_paths: [plain, image, missing] };
  const deliveries = await Promise.all([client.POST("/api/v1/import-batches", { body }), client.POST("/api/v1/import-batches", { body })]);
  assert(deliveries[0].data); assert.deepEqual(deliveries[0].data, deliveries[1].data);
  const finished = await until(s => s.batches[0]?.original_ended === true);
  const batch = finished.batches[0]; assert.equal(batch.items.length, 3); assert(batch.items[0].current.complete); assert(batch.items[1].current.complete); assert.equal(batch.items[2].current.base.state, "failed");
  const output = batch.items[1].current.kinds.find(k => k.kind === "image")!.output!; assert(output);
  const bytes = await client.GET("/api/v1/previews/{locator}/bytes", { params: { path: { locator: output.locator } }, parseAs: "arrayBuffer" }); assert(bytes.data && bytes.data.byteLength > 0);
  await writeFile(missing, "explicit recovery bytes");
  const recovery = { request_id: randomUUID(), batch_id: batch.batch_id, item_id: batch.items[2].item_id, action: "recopy" as const };
  const accepted = await client.POST("/api/v1/import-recoveries", { body: recovery }); assert(accepted.data);
  const recovered = await until(s => s.batches[0].items[2].current.complete);
  assert.deepEqual(recovered.batches[0].items[2].attempts[0], batch.items[2].attempts[0]);
  assert.deepEqual((await client.POST("/api/v1/import-recoveries", { body: recovery })).data, accepted.data);
  assert.equal(await readFile(plain, "utf8"), "ordinary file");
  await client.POST("/api/v1/drain"); await exited;
  await mkdir(join(workspace, "target"), { recursive: true });
  await writeFile(join(workspace, "target/import-client-smoke.json"), JSON.stringify({ passed: true, root, snapshot: recovered }, null, 2));
  console.log(`PASS generated-client mixed File/Image import, duplicate delivery, attributed preview bytes, explicit recopy and immutable attempts, drain. Fixtures retained: ${root}`);
} finally { if (child.exitCode === null) { child.kill(); await exited; } }

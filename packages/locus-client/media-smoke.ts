import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createLocusClient, type BackendContext, type TaskOutcome, type components } from "./src/index.js";
import { fixturePng, decodePng } from "./smoke-png.js";
const video = process.argv.includes("--video");
const workspace = fileURLToPath(new URL("../../", import.meta.url));
const binary = join(workspace, "target/debug", process.platform === "win32" ? "locus-server.exe" : "locus-server");
const temporary = await mkdtemp(join(tmpdir(), "locus-media-smoke-"));
const children: ReturnType<typeof spawn>[] = []; const sockets: Socket[] = [];
const deadline = AbortSignal.timeout(60_000);
async function start() {
  const credential = randomBytes(32).toString("hex"); const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, ...(video ? {} : { LOCUS_FFPROBE: join(temporary, "absent-ffprobe"), LOCUS_FFMPEG: join(temporary, "absent-ffmpeg") }) } }); children.push(child);
  let diagnostics = ""; child.stderr.on("data", (chunk: Buffer) => { diagnostics += chunk.toString(); });
  const exited = once(child, "exit").then(([code]) => { assert(!diagnostics.includes(credential)); assert.equal(code, 0, diagnostics); }); void exited.catch(() => {});
  const lines = createInterface({ input: child.stdout }); const next = once(lines, "line", { signal: deadline });
  child.stdin.end(JSON.stringify({ credential, library_root: join(temporary, "library") }));
  const [line] = await Promise.race([next, exited.then(() => { throw new Error("server exited before readiness"); })]);
  assert(!String(line).includes(credential)); const ready = JSON.parse(String(line)) as { origin: string; run_id: string };
  const context: BackendContext = { origin: ready.origin, runId: ready.run_id };
  const authorizedFetch: typeof globalThis.fetch = async (input, init) => { const request = new Request(input, init); assert.equal(new URL(request.url).origin, context.origin); request.headers.set("Authorization", `Bearer ${credential}`); return fetch(new Request(request, { redirect: "error", signal: deadline })); };
  return { client: createLocusClient(context, authorizedFetch), context, authorizedFetch, credential, exited };
}
type Running = Awaited<ReturnType<typeof start>>;
async function complete(server: Running, taskId: string): Promise<TaskOutcome> {
  for (;;) { const r = await server.client.GET("/api/v1/tasks/{task_id}/outcome", { params: { path: { task_id: taskId } } }); assert(r.data, JSON.stringify(r.error)); if (r.data.status === "complete") return r.data.outcome; await delay(2, undefined, { signal: deadline }); }
}
async function imported(server: Running, source: string) {
  const result = await server.client.POST("/api/v1/imports", { body: { request_id: randomUUID(), source_path: source } }); assert(result.data);
  const outcome = await complete(server, result.data.task_id); assert(outcome.status === "imported", JSON.stringify(outcome)); return outcome.file;
}
async function passive(server: Running, path: string) {
  const url = new URL(server.context.origin); const socket = connect({ host: url.hostname, port: Number(url.port) }); sockets.push(socket); socket.on("error", () => {}); await once(socket, "connect"); socket.pause();
  socket.write(`GET ${path} HTTP/1.1\r\nHost: ${url.host}\r\nAuthorization: Bearer ${server.credential}\r\nX-Locus-Run: ${server.context.runId}\r\n\r\n`);
}
try {
  const source = join(temporary, video ? "synthetic.mp4" : "synthetic.png");
  if (video) {
    await promisify(execFile)(process.env.LOCUS_FFPROBE ?? "ffprobe", ["-version"], { windowsHide: true });
    await promisify(execFile)(process.env.LOCUS_FFMPEG ?? "ffmpeg", ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=blue:s=64x40:r=5:d=1", "-c:v", "mpeg4", "-threads", "1", "-y", source], { windowsHide: true });
  } else await writeFile(source, fixturePng(64, 40));
  const original = await readFile(source); const server = await start(); const client = server.client; const file = await imported(server, source);
  const requestId = randomUUID();
  const creates = await Promise.all(Array.from({ length: 4 }, () => client.POST("/api/v1/entities", { body: { request_id: requestId } })));
  const created = creates[0].data; assert(created?.status === "entity_created"); for (const c of creates) assert.deepEqual(c.data, created);
  const recovered = await client.GET("/api/v1/requests/{request_id}", { params: { path: { request_id: requestId } } }); assert(recovered.data?.status === "direct_complete"); assert.deepEqual(recovered.data.outcome, created);
  assert.equal((await client.POST("/api/v1/media", { body: { request_id: requestId, kind: "image" } })).error?.code, "request_conflict");
  const kind = video ? "video" : "image";
  const mediaRequest = randomUUID(); const media = await client.POST("/api/v1/media", { body: { request_id: mediaRequest, kind } }); assert(media.data?.status === "media_created");
  assert.deepEqual((await client.POST("/api/v1/media", { body: { request_id: mediaRequest, kind } })).data, media.data);
  const target = media.data.target; const params = { path: { kind, component_id: target.component_id } } as const;
  const unmounted = await client.GET("/api/v1/media/{kind}/{component_id}/view", { params }); assert.equal(unmounted.data?.applicability.status, "unmounted"); assert.equal(unmounted.data?.record.facts, null);
  const failed = await client.POST("/api/v1/interpretations", { body: { request_id: randomUUID(), target } }); assert(failed.data);
  const failure = await complete(server, failed.data.task_id); assert(failure.status === "interpreted" && failure.result.status === "accepted"); assert.equal(failure.result.record.last_failure?.code, "missing_input");
  const memberships: components["schemas"]["Membership"][] = [
    { entity_id: created.entity_id, kind_id: file.kind_id, component_id: file.file_id },
    { entity_id: created.entity_id, kind_id: media.data.kind_id, component_id: target.component_id },
  ];
  for (const membership of memberships) { const request_id = randomUUID(); const attached = await client.POST("/api/v1/memberships/attach", { body: { request_id, membership } }); assert.equal(attached.data?.status, "attached"); assert.deepEqual((await client.POST("/api/v1/memberships/attach", { body: { request_id, membership } })).data, attached.data); }
  assert.equal((await client.GET("/api/v1/entities/{entity_id}/memberships", { params: { path: { entity_id: created.entity_id } } })).data?.length, 2);
  const interpretationId = randomUUID(); const receipt = await client.POST("/api/v1/interpretations", { body: { request_id: interpretationId, target } }); assert(receipt.data); assert.equal(receipt.response.status, 202);
  assert.deepEqual((await client.POST("/api/v1/interpretations", { body: { request_id: interpretationId, target } })).data, receipt.data);
  const interpreted = await complete(server, receipt.data.task_id); assert(interpreted.status === "interpreted" && interpreted.result.status === "accepted", JSON.stringify(interpreted)); const record = interpreted.result.record;
  assert.equal(record.last_failure, null); assert.equal(record.basis, file.file_id); assert.equal(record.facts?.kind, kind); assert.equal(record.facts?.width, 64); assert.equal(record.facts?.height, 40);
  assert.deepEqual((await client.GET("/api/v1/media/{kind}/{component_id}", { params })).data, record);
  assert.equal((await client.GET("/api/v1/media/{kind}/{component_id}/view", { params })).data?.applicability.status, "matching");
  const entries = await client.GET("/api/v1/entities/{entity_id}/media", { params: { path: { entity_id: created.entity_id } } }); assert.equal(entries.data?.length, 1); assert.equal(entries.data?.[0].result.status, "readable");
  const previewId = randomUUID(); const generated = await client.POST("/api/v1/previews", { body: { request_id: previewId, target, edge: 32 } }); assert(generated.data); assert.equal(generated.response.status, 202);
  assert.deepEqual((await client.POST("/api/v1/previews", { body: { request_id: previewId, target, edge: 32 } })).data, generated.data);
  const preview = await complete(server, generated.data.task_id); assert(preview.status === "preview", JSON.stringify(preview)); assert.equal(preview.preview.origin, "generated"); assert.equal(preview.preview.file_id, file.file_id);
  assert.equal(preview.preview.stream_index, video ? 0 : null);
  const hit = await client.POST("/api/v1/previews", { body: { request_id: randomUUID(), target, edge: 32 } }); assert(hit.data); assert.equal(hit.response.status, 202); const cached = await complete(server, hit.data.task_id); assert(cached.status === "preview"); assert.equal(cached.preview.origin, "hit");
  const pngParams = { path: { locator: preview.preview.locator } };
  const png = await client.GET("/api/v1/previews/{locator}/bytes", { params: pngParams, parseAs: "arrayBuffer" }); assert(png.data); assert.equal(png.response.headers.get("content-type"), "image/png"); assert.equal(png.response.headers.get("x-content-type-options"), "nosniff"); assert.equal(png.response.headers.get("content-length"), String(png.data.byteLength));
  const decoded = decodePng(Buffer.from(png.data)); assert.equal(decoded.width, 32); assert.equal(decoded.height, 20); assert(decoded.pixels.some(b => b > 0));
  const head = await client.HEAD("/api/v1/previews/{locator}/bytes", { params: pngParams }); assert.equal(head.response.status, 200); assert.equal(head.response.headers.get("content-length"), String(png.data.byteLength)); assert.equal(await head.response.text(), "");
  const bytesParams = { path: { file_id: file.file_id } };
  const bytes = await client.GET("/api/v1/files/{file_id}/bytes", { params: bytesParams, headers: { Range: "bytes=0-1" }, parseAs: "arrayBuffer" }); assert(bytes.data); assert.equal(bytes.response.status, 200); assert.deepEqual(Buffer.from(bytes.data), original); assert.equal(bytes.response.headers.get("content-disposition"), "attachment"); assert.equal(bytes.response.headers.get("content-type"), "application/octet-stream");
  const originalHead = await client.HEAD("/api/v1/files/{file_id}/bytes", { params: bytesParams }); assert.equal(originalHead.response.headers.get("content-length"), String(original.length));
  assert.deepEqual(await readFile(source), original);
  const empty = join(temporary, "empty"); await writeFile(empty, ""); const zero = await imported(server, empty); const emptyBytes = await client.GET("/api/v1/files/{file_id}/bytes", { params: { path: { file_id: zero.file_id } }, parseAs: "arrayBuffer" }); assert.equal(emptyBytes.response.status, 200); assert.equal(emptyBytes.response.headers.get("content-length"), "0"); assert.equal(emptyBytes.data?.byteLength ?? (await emptyBytes.response.arrayBuffer()).byteLength, 0);
  const absent = await client.GET("/api/v1/previews/{locator}/bytes", { params: { path: { locator: randomUUID() } } }); assert.equal(absent.error?.code, "preview_unavailable");
  assert.equal((await fetch(`${server.context.origin}/api/v1/previews/${preview.preview.locator}/bytes`, { signal: deadline })).status, 401);
  const wrong = createLocusClient({ ...server.context, runId: randomUUID() }, server.authorizedFetch); assert.equal((await wrong.GET("/api/v1/files/{file_id}/bytes", { params: bytesParams })).error?.code, "wrong_run");
  // A real unread representation and SSE connection cannot hold normal exit open.
  const large = join(temporary, "slow.bin"); await writeFile(large, Buffer.alloc(16 * 1024 * 1024, 0x31)); const largeFile = await imported(server, large);
  await passive(server, `/api/v1/files/${largeFile.file_id}/bytes`); await passive(server, "/api/v1/events");
  assert((await client.POST("/api/v1/entities", { body: { request_id: randomUUID() } })).data);
  await client.POST("/api/v1/drain"); await Promise.race([server.exited, delay(5000).then(() => { throw new Error("slow bytes prevented drain"); })]);
  const restarted = await start(); assert.notEqual(restarted.context.runId, server.context.runId);
  assert.deepEqual((await restarted.client.GET("/api/v1/media/{kind}/{component_id}", { params })).data, record);
  assert.equal((await restarted.client.GET("/api/v1/requests/{request_id}", { params: { path: { request_id: requestId } } })).error?.code, "unknown_request");
  assert.equal((await restarted.client.GET("/api/v1/tasks/{task_id}", { params: { path: { task_id: receipt.data.task_id } } })).error?.code, "unknown_task");
  assert.equal((await restarted.client.GET("/api/v1/previews/{locator}/bytes", { params: pngParams })).error?.code, "preview_unavailable");
  await restarted.client.POST("/api/v1/drain"); await restarted.exited;
  console.log(`PASS real generated-client ${kind}: independent import/create/attach, recovery, warning/retry, retained/current reads, generated/cache-hit tasks, decoded PNG ${decoded.width}x${decoded.height}, original/HEAD/Range, authorization, restart, drain with unread media and SSE.`);
} finally {
  for (const socket of sockets) socket.destroy();
  for (const child of children) if (child.exitCode === null) { child.kill(); await once(child, "exit").catch(() => {}); }
  if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected temporary cleanup path");
  await rm(temporary, { recursive: true, force: true });
}

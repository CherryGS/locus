import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createLocusClient, type BackendContext, type ImportOutcome, type TaskSnapshot } from "./src/index.js";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const binary = join(workspace, "target/debug", process.platform === "win32" ? "locus-server.exe" : "locus-server");
const temporary = await mkdtemp(join(tmpdir(), "locus-server-smoke-"));
const children: ReturnType<typeof spawn>[] = [];
const sockets: Socket[] = [];
const deadline = AbortSignal.timeout(30_000);

async function start() {
  const credential = randomBytes(32).toString("hex");
  const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  children.push(child);
  let diagnostics = "";
  child.stderr.on("data", (chunk: Buffer) => { diagnostics += chunk.toString(); });
  const exited = once(child, "exit").then(([code]) => {
    assert(!diagnostics.includes(credential), "credential leaked in diagnostics");
    assert.equal(code, 0, diagnostics);
  });
  // Attach rejection immediately; startup failure is also observed below.
  void exited.catch(() => {});
  const lines = createInterface({ input: child.stdout });
  const next = once(lines, "line", { signal: deadline });
  child.stdin.end(JSON.stringify({ credential, library_root: join(temporary, "library") }));
  const [line] = await Promise.race([next, exited.then(() => { throw new Error("server exited before readiness"); })]);
  assert(!String(line).includes(credential));
  const ready = JSON.parse(String(line)) as { origin: string; run_id: string };
  assert.match(ready.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const context: BackendContext = { origin: ready.origin, runId: ready.run_id };
  const authorizedFetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).origin, context.origin, "credential origin scope");
    request.headers.set("Authorization", `Bearer ${credential}`);
    // No redirects may carry host authorization elsewhere.
    return fetch(new Request(request, { redirect: "error", signal: deadline }));
  };
  const client = createLocusClient(context, authorizedFetch);
  return { child, exited, context, client, authorizedFetch, credential };
}
type Running = Awaited<ReturnType<typeof start>>;

async function complete(server: Running, taskId: string): Promise<ImportOutcome> {
  for (;;) {
    const result = await server.client.GET("/api/v1/tasks/{task_id}/outcome", { params: { path: { task_id: taskId } } });
    assert(result.data, JSON.stringify(result.error));
    if (result.data.status === "complete") return result.data.outcome;
    await delay(2, undefined, { signal: deadline });
  }
}

async function stream(server: Running) {
  const controller = new AbortController();
  const response = await fetch(`${server.context.origin}/api/v1/events`, {
    headers: { Authorization: `Bearer ${server.credential}`, "X-Locus-Run": server.context.runId },
    signal: AbortSignal.any([deadline, controller.signal]),
  });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  let pending = "";
  const decoder = new TextDecoder();
  async function snapshot(): Promise<TaskSnapshot> {
    for (;;) {
      const boundary = pending.indexOf("\n\n");
      if (boundary >= 0) {
        const event = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const data = event.split("\n").find((line) => line.startsWith("data: "));
        if (data) return JSON.parse(data.slice(6)) as TaskSnapshot;
      }
      const next = await reader.read();
      assert(!next.done, "SSE ended before snapshot");
      pending += decoder.decode(next.value, { stream: true });
    }
  }
  return { snapshot, close: () => controller.abort() };
}

async function passive(server: Running, kind: "partial" | "sse") {
  const url = new URL(server.context.origin);
  const socket = connect({ host: url.hostname, port: Number(url.port) }); sockets.push(socket);
  socket.on("error", () => {});
  await once(socket, "connect");
  socket.pause();
  const headers = `Host: ${url.host}\r\nAuthorization: Bearer ${server.credential}\r\nX-Locus-Run: ${server.context.runId}\r\n`;
  socket.write(kind === "partial"
    ? `POST /api/v1/imports HTTP/1.1\r\n${headers}Content-Type: application/json\r\nContent-Length: 1000\r\n\r\n{`
    : `GET /api/v1/events HTTP/1.1\r\n${headers}\r\n`);
}

try {
  const original = join(temporary, "synthetic.bin");
  const bytes = Buffer.from("Locus generated client real File smoke\n");
  await writeFile(original, bytes);
  const server = await start();
  const unauthorized = await fetch(`${server.context.origin}/api/v1/server`, { signal: deadline });
  assert.equal(unauthorized.status, 401);
  const foreign = await server.authorizedFetch(`${server.context.origin}/api/v1/server`, { headers: { Origin: "https://foreign.example", "X-Locus-Run": server.context.runId } });
  assert.equal(foreign.status, 403);
  const initial = await stream(server);
  assert.equal((await initial.snapshot()).tasks.length, 0);
  const requestId = randomUUID();
  const submissions = await Promise.all(Array.from({ length: 4 }, () => server.client.POST("/api/v1/imports", { body: { request_id: requestId, source_path: original } })));
  const receipt = submissions[0].data;
  assert(receipt);
  for (const result of submissions) { assert.equal(result.response.status, 202); assert.deepEqual(result.data, receipt); }
  initial.close(); // a lost observer does not affect the work
  const recovery = await server.client.GET("/api/v1/requests/{request_id}", { params: { path: { request_id: requestId } } });
  assert.equal(recovery.data?.status, "accepted");
  if (recovery.data?.status === "accepted") assert.deepEqual(recovery.data.receipt, receipt);
  const outcome = await complete(server, receipt.task_id);
  assert.equal(outcome.status, "imported");
  if (outcome.status !== "imported") throw new Error("unexpected import failure");
  const metadata = await server.client.GET("/api/v1/files/{file_id}", { params: { path: { file_id: outcome.file.file_id } } });
  assert.deepEqual(metadata.data, outcome.file);
  assert.equal(outcome.file.byte_count, String(bytes.length));
  assert.deepEqual(await readFile(original), bytes);
  assert.deepEqual(await readFile(join(temporary, "library", outcome.file.relative_path)), bytes);
  const reconnected = await stream(server);
  const snapshot = await reconnected.snapshot();
  assert(snapshot.tasks.some((task) => task.task_id === receipt.task_id && task.outcome_available));
  reconnected.close();
  const conflict = await server.client.POST("/api/v1/imports", { body: { request_id: requestId, source_path: join(temporary, "other") } });
  assert.equal(conflict.error?.code, "request_conflict");
  const wrongRun = createLocusClient({ ...server.context, runId: randomUUID() }, server.authorizedFetch);
  assert.equal((await wrongRun.POST("/api/v1/imports", { body: { request_id: randomUUID(), source_path: original } })).error?.code, "wrong_run");
  const failure = await server.client.POST("/api/v1/imports", { body: { request_id: randomUUID(), source_path: join(temporary, "missing") } });
  assert(failure.data);
  const domainFailure = await complete(server, failure.data.task_id);
  assert.equal(domainFailure.status, "failed");
  if (domainFailure.status === "failed") {
    assert.equal(domainFailure.diagnostic.kind, "input_missing");
    assert(domainFailure.progress?.file_id);
    assert.equal(domainFailure.progress.copy_complete, false);
  }

  // Bounded local JSON baseline; includes fetch/HTTP/JSON, not code generation.
  for (let i = 0; i < 10; i++) assert((await server.client.GET("/api/v1/server")).data);
  const samples: number[] = [];
  for (let i = 0; i < 100; i++) {
    const begin = performance.now(); assert((await server.client.GET("/api/v1/server")).data); samples.push(performance.now() - begin);
  }
  samples.sort((a, b) => a - b);

  const large = join(temporary, "copy-responsiveness.bin");
  const file = await open(large, "w");
  try { const block = Buffer.alloc(1024 * 1024, 0x6c); for (let i = 0; i < 128; i++) await file.write(block); } finally { await file.close(); }
  const copying = await server.client.POST("/api/v1/imports", { body: { request_id: randomUUID(), source_path: large } });
  assert(copying.data);
  let activeSamples = 0;
  let maxDuringCopy = 0;
  for (let i = 0; i < 100; i++) {
    const begin = performance.now(); const status = await server.client.GET("/api/v1/server");
    const elapsed = performance.now() - begin;
    assert(status.data);
    if (status.data.active_operations !== "0") { activeSamples++; maxDuringCopy = Math.max(maxDuringCopy, elapsed); } else break;
  }
  assert(activeSamples > 0, "must observe responsive status while real copy is active");
  assert.equal((await complete(server, copying.data.task_id)).status, "imported");
  // Hold both an unread SSE socket and a deliberately unfinished JSON body.
  await passive(server, "sse"); await passive(server, "partial");
  const drained = await server.client.POST("/api/v1/drain");
  assert.equal(drained.data?.admission, "drained");
  await Promise.race([server.exited, delay(5000).then(() => { throw new Error("passive clients prevented shutdown"); })]);

  const restarted = await start();
  assert.notEqual(restarted.context.runId, server.context.runId);
  assert.deepEqual((await restarted.client.GET("/api/v1/files/{file_id}", { params: { path: { file_id: outcome.file.file_id } } })).data, outcome.file);
  assert.equal((await restarted.client.GET("/api/v1/tasks/{task_id}", { params: { path: { task_id: receipt.task_id } } })).error?.code, "unknown_task");
  assert.equal((await createLocusClient({ ...restarted.context, runId: server.context.runId }, restarted.authorizedFetch).GET("/api/v1/tasks")).error?.code, "wrong_run");
  await restarted.client.POST("/api/v1/drain"); await restarted.exited;
  console.log(`PASS real debug binary/client: copy, typed failure, recovery, SSE, restart, drain with passive clients. Warm loopback JSON: n=100 median=${samples[50].toFixed(3)}ms p95=${samples[94].toFixed(3)}ms. During 128 MiB copy: ${activeSamples} active status requests, max=${maxDuringCopy.toFixed(3)}ms. Local sample, not application throughput.`);
} finally {
  for (const socket of sockets) socket.destroy();
  for (const child of children) if (child.exitCode === null) { child.kill(); await once(child, "exit").catch(() => {}); }
  if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected temporary cleanup path");
  await rm(temporary, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createLocusClient, type TaskOutcome } from "../src/index.js";

export const workspace = fileURLToPath(new URL("../../../", import.meta.url));
export const binary = join(workspace, "target/debug", process.platform === "win32" ? "locus-server.exe" : "locus-server");

/** Consumers always create their own temporary library; no default-root path. */
export async function entityFixture(label: "smoke" | "scale") {
  const root = await mkdtemp(join(tmpdir(), `locus-entity-${label}-`));
  const library = join(root, "library");
  const children: ReturnType<typeof spawn>[] = [];
  async function start(settingsEnvironment?: { ffprobe?: string; ffmpeg?: string }) {
    const credential = randomBytes(32).toString("hex");
    const deadline = AbortSignal.timeout(120_000);
    const environment = { ...process.env };
    delete environment.LOCUS_FFPROBE; delete environment.LOCUS_FFMPEG;
    const overrides = settingsEnvironment ?? { ffprobe: join(root, "unavailable-ffprobe"), ffmpeg: join(root, "unavailable-ffmpeg") };
    if (overrides.ffprobe !== undefined) environment.LOCUS_FFPROBE = overrides.ffprobe;
    if (overrides.ffmpeg !== undefined) environment.LOCUS_FFMPEG = overrides.ffmpeg;
    const child = spawn(binary, [], {
      stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
      env: environment,
    });
    children.push(child);
    let diagnostics = "";
    child.stderr.on("data", (bytes: Buffer) => { diagnostics += bytes.toString(); });
    const exited = once(child, "exit").then(([code]) => {
      assert(!diagnostics.includes(credential)); assert.equal(code, 0, diagnostics);
    });
    void exited.catch(() => {});
    const lines = createInterface({ input: child.stdout });
    const next = once(lines, "line", { signal: deadline });
    child.stdin.end(JSON.stringify({ credential, library_root: library }));
    const [line] = await Promise.race([next, exited.then(() => { throw new Error("Server exited before readiness"); })]);
    assert(!String(line).includes(credential));
    const ready = JSON.parse(String(line)) as { origin: string; run_id: string };
    assert.match(ready.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const context = { origin: ready.origin, runId: ready.run_id };
    const authorizedFetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      assert.equal(new URL(request.url).origin, context.origin);
      request.headers.set("Authorization", `Bearer ${credential}`);
      return fetch(new Request(request, { redirect: "error", signal: AbortSignal.any([deadline, request.signal]) }));
    };
    const client = createLocusClient(context, authorizedFetch);
    async function stop() { assert.equal((await client.POST("/api/v1/drain")).data?.admission, "drained"); await exited; }
    return { child, client, context, authorizedFetch, exited, stop };
  }
  async function dispose() {
    for (const child of children) if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill(); await once(child, "exit").catch(() => {});
    }
    const target = resolve(root);
    if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error("Unexpected fixture cleanup path");
    await rm(target, { recursive: true, force: true });
  }
  return { root, library, start, dispose };
}

export async function complete(client: ReturnType<typeof createLocusClient>, taskId: string): Promise<TaskOutcome> {
  const deadline = AbortSignal.timeout(30_000);
  for (;;) {
    const result = await client.GET("/api/v1/tasks/{task_id}/outcome", { params: { path: { task_id: taskId } }, signal: deadline });
    assert(result.data, JSON.stringify(result.error));
    if (result.data.status === "complete") return result.data.outcome;
    await delay(2, undefined, { signal: deadline });
  }
}

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, stat, rm, readdir } from "node:fs/promises";
import { cpus, platform, release, totalmem } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { setImmediate as nextTurn } from "node:timers/promises";
import { searchEntities, type EntitySequence } from "./src/index.js";
import { binary, entityFixture, workspace } from "./support/entity-fixture.js";

const execute = promisify(execFile);
const count = Number(process.argv[2] ?? 1_000_000);
assert(Number.isSafeInteger(count) && count >= 1, "count must be a positive safe integer");
const fixture = await entityFixture("scale");

async function serverMemory(pid: number) {
  if (process.platform === "win32") {
    assert(Number.isSafeInteger(pid) && pid > 0);
    const result = await execute("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", `Get-Process -Id ${pid} | Select-Object WorkingSet64,PeakWorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`], { windowsHide: true });
    const sample = JSON.parse(result.stdout) as { WorkingSet64: number; PeakWorkingSet64: number; PrivateMemorySize64: number };
    return { rssBytes: sample.WorkingSet64, peakRssBytes: sample.PeakWorkingSet64, privateBytes: sample.PrivateMemorySize64, peakScope: "OS working-set high-water mark since this server process started" };
  }
  if (process.platform === "linux") {
    const status = await readFile(`/proc/${pid}/status`, "utf8");
    const metric = (name: string) => Number(status.match(new RegExp(`^${name}:\\s+(\\d+) kB`, "m"))?.[1]) * 1024;
    return { rssBytes: metric("VmRSS"), peakRssBytes: metric("VmHWM"), peakScope: "OS RSS high-water mark since this server process started" };
  }
  const sample = await execute("ps", ["-o", "rss=", "-p", String(pid)]);
  return { rssBytes: Number(sample.stdout.trim()) * 1024, peakScope: "instant RSS sample only; server peak unavailable on this platform" };
}

try {
  // Initialize the actual application's schemas, stop it, then seed offline.
  const initializer = await fixture.start(); await initializer.stop();
  const seeded = await execute("uv", ["run", "python", join(workspace, "scripts/seed-entity-scale.py"), join(fixture.library, "metadata.sqlite"), String(count)], { cwd: workspace, windowsHide: true, timeout: 180_000 });
  const setup = JSON.parse(seeded.stdout) as { entityCount: number; totalDatabaseRows: number };
  assert.equal(setup.entityCount, count);
  const projection = JSON.parse((await execute("uv", ["run", "python", join(workspace,"scripts/measure-search-projection.py"),join(fixture.library,"metadata.sqlite")],{cwd:workspace,windowsHide:true})).stdout);
  const databaseBytes = (await stat(join(fixture.library, "metadata.sqlite"))).size;
  // A fresh server separates the measured process high-water mark from fixture setup.
  await rm(join(fixture.library,"cache","search"),{recursive:true,force:true});
  const buildStarted=performance.now();
  const server = await fixture.start(undefined,900_000); const client = server.client; assert(server.child.pid);
  for (;;) {
    const status=await client.GET("/api/v1/search/status");assert(status.data,JSON.stringify(status.error));assert.notEqual(status.data.state,"failed",status.data.failure??"");
    if(status.data.state==="ready")break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  const indexBuildMs=performance.now()-buildStarted;
  const indexRoot=join(fixture.library,"cache","search");let indexBytes=0;
  for(const relative of await readdir(indexRoot,{recursive:true})){const entry=await stat(join(indexRoot,relative));if(entry.isFile())indexBytes+=entry.size;}
  const serverBaseline = await serverMemory(server.child.pid);
  globalThis.gc?.();
  const clientBaseline = process.memoryUsage();
  const sampledPeak = { ...clientBaseline };
  let memorySamples = 0;
  const sample = () => {
    memorySamples++;
    const current = process.memoryUsage();
    for (const key of Object.keys(sampledPeak) as (keyof typeof sampledPeak)[]) sampledPeak[key] = Math.max(sampledPeak[key], current[key]);
  };
  const sampler = setInterval(sample, 5);
  const started = performance.now();
  let identities: EntitySequence;
  let observation;
  try { observation=await searchEntities(client,{ format: "locus-native-tantivy-0.26", version: 2, text: "entity_id:*" }); identities=observation.entities; } finally { sample(); clearInterval(sampler); }
  const firstUsableMs = performance.now() - started;
  const clientAfterRead = process.memoryUsage();
  const clientLifetimePeakRssBytes = process.resourceUsage().maxRSS * 1024;
  const serverAfterRead = await serverMemory(server.child.pid);
  assert.equal(identities.length, count); assert.equal(identities.byteLength, count * 16);

  // Validate fixture identity coverage with a compact bitset, outside timed read.
  // Drop each materialized UUID immediately; do not retain an object/string map.
  const seen = new Uint8Array(Math.ceil(count / 8));
  const verificationStart = performance.now();
  for (let position = 0; position < count; position++) {
    const id = identities.at(position)!;
    assert.equal(id.slice(0, 19), "01992853-c123-7000-");
    const ordinal = Number(BigInt(`0x${id.slice(19).replaceAll("-", "")}`) - 0x8000000000000000n);
    assert(ordinal >= 0 && ordinal < count); assert.equal(seen[ordinal >>> 3] & (1 << (ordinal & 7)), 0);
    seen[ordinal >>> 3] |= 1 << (ordinal & 7);
  }
  const coverageVerificationMs = performance.now() - verificationStart;
  const indexedStart = performance.now(); let checksum = 0;
  for (let i = 0; i < 10_000; i++) checksum += identities.at((i * 9973) % count)!.length;
  const indexedTotalMs = performance.now() - indexedStart; assert.equal(checksum, 360_000);
  const positions = [0, Math.floor(count / 2), count - 1];
  const lookups = positions.map(position => {
    const id = identities.at(position)!; const started = performance.now(); const found = identities.indexOf(id);
    const elapsedMs = performance.now() - started; assert.equal(found, position); return { position, elapsedMs };
  });
  const absentStarted = performance.now(); assert.equal(identities.indexOf("01992853-c123-7000-bfff-ffffffffffff"), -1);
  const absentLookupMs = performance.now() - absentStarted;
  const batch = await client.POST("/api/v1/memberships/read", { body: { entity_ids: positions.map(position => identities.at(position)!) } });
  assert.equal(batch.data?.length, 3);
  for (const row of batch.data ?? []) assert(row.status === "present" && row.memberships.length === 0);
  // Let completed fetch callbacks release temporary native buffers before the
  // separately qualified retained sample. The earlier transfer peak is unchanged.
  await nextTurn(); globalThis.gc?.(); await nextTurn(); globalThis.gc?.();
  const clientRetainedSample = process.memoryUsage();
  console.log(JSON.stringify({
    fixture: { ...setup, databaseBytes, indexBytes, projection },
    conditions: { os: `${platform()} ${release()}`, arch: process.arch, cpu: cpus()[0]?.model, logicalCpus: cpus().length, physicalMemoryBytes: totalmem(), node: process.version, server: binary, build: "Cargo dev profile as defined by workspace; optimized + debuginfo, fresh server, warm filesystem after seeding", runtime: "application-owned multi-thread Tokio; pinned diesel-async SQLite wrapper", gcExposed: typeof globalThis.gc === "function" },
    search: { indexBuildMs, entityCount: identities.length, wireIdBytes: identities.byteLength, retainedIdBytes: identities.byteLength, firstUsableMs, includes: "exhaustive Tantivy fast-field collection, full sort, HTTP transfer, fetch allocation/copies, full buffer and UUID validation; excludes fixture setup and subsequent coverage/lookup checks" },
    lookups: { indexedCount: 10_000, indexedTotalMs, indexedMeanUs: indexedTotalMs * 1000 / 10_000, identityPosition: lookups, absentLookupMs, policy: "O(1) indexed access; O(n) identity scan; no auxiliary retained identity index" },
    memory: { server: { baseline: serverBaseline, afterRead: serverAfterRead }, client: { baseline: clientBaseline, afterRead: clientAfterRead, sampledPeakDuringRead: sampledPeak, memorySamples, sampleIntervalMs: 5, lifetimePeakRssBytes: clientLifetimePeakRssBytes, retainedAfterChecksAndGc: clientRetainedSample, note: "all values bytes; RSS high-water includes client startup; sampled peak may miss synchronous copying; external/arrayBuffers overlap, do not sum. Retained sample follows checks, two event-loop turns and explicit GC when exposed; it is not a memory bound. Coverage verification uses a temporary compact bitset outside read timing." } },
    coverageVerificationMs,
    qualification: "one local measurement, no throughput/SLA or unlimited-size claim; 16-byte arithmetic is payload size, not total process memory",
  }, null, 2));
  await observation?.release();
  await server.stop();
} finally { await fixture.dispose(); }

import assert from "node:assert/strict";
import test from "node:test";
import { createLocusClient, searchEntities, EntityReadError } from "../src/index.js";
const id = "01992853-c123-7000-8000-000000000001";
const bytes = Uint8Array.from(Buffer.from(id.replaceAll("-", ""), "hex"));
const headers = { "content-type": "application/octet-stream", "content-length": "16", "x-locus-search-context": id, "x-locus-search-generation": id, "x-locus-search-sequence": "9223372036854775807", "x-locus-search-expires": "600" };
function client(response: () => Response) { return createLocusClient({ origin: "http://127.0.0.1:1", runId: "run" }, async (input, init) => { const request = new Request(input, init); assert.equal(request.headers.get("x-locus-run"), "run"); return request.url.endsWith("/release") ? new Response(null, { status: 204 }) : response(); }); }
test("search retains checked packed IDs and exact metadata through release", async () => {
  const result = await searchEntities(client(() => new Response(bytes, { headers })), { format: "locus-native-tantivy-0.26", version: 2, text: "entity_id:*" }); assert.equal(result.entities.at(0), id); assert.equal(result.coveredSequence, "9223372036854775807"); await result.release(); assert.equal(result.entities.byteLength, 16);
});
test("search rejects truncation, missing metadata and malformed identity", async () => {
  for (const override of [{ "content-length": "32" }, { "x-locus-search-context": "invalid" }, { "x-locus-search-expires": "0" }, { "x-locus-search-sequence": "9223372036854775808" }]) {
    await assert.rejects(searchEntities(client(() => new Response(bytes, { headers: { ...headers, ...override } })), { format: "locus-native-tantivy-0.26", version: 2, text: "entity_id:*" }), EntityReadError);
  }
  await assert.rejects(searchEntities(client(() => new Response(new Uint8Array(16), { headers })), { format: "locus-native-tantivy-0.26", version: 2, text: "entity_id:*" }), EntityReadError);
});
test("rejected complete transfer retires its obtainable evidence context", async () => {
  const released: string[] = [];
  const api = createLocusClient({ origin: "http://127.0.0.1:1", runId: "run" }, async (input, init) => {
    const request = new Request(input, init);
    if (request.url.endsWith("/release")) { released.push((await request.json()).context); return new Response(null, { status: 204 }); }
    return new Response(bytes, { headers: { ...headers, "content-length": "32" } });
  });
  await assert.rejects(searchEntities(api, { format: "locus-native-tantivy-0.26", version: 2, text: "entity_id:*" }), EntityReadError);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(released, [id]);
});

test("supported empty source is a complete enumeration without a fabricated search context", async () => {
 const result = await searchEntities(client(() => new Response(bytes, { headers: { "content-type": "application/octet-stream", "content-length": "16", "x-locus-search-no-filter": "true" } })), { format: "locus-native-tantivy-0.26", version: 2, text: "  " });
 assert.equal(result.context, null); assert.equal(result.generation, null); assert.equal(result.entities.length, 1); await result.release();
});

test("no-filter never excuses malformed identities, missing search metadata or mismatched request source", async () => {
 const query = { format: "locus-native-tantivy-0.26", version: 2, text: "" };
 for (const extra of [{ "content-length": "32" }, { "x-locus-search-generation": id }] as Record<string, string>[]) await assert.rejects(searchEntities(client(() => new Response(bytes, { headers: { "content-type": "application/octet-stream", "content-length": "16", "x-locus-search-no-filter": "true", ...extra } })), query), EntityReadError);
 await assert.rejects(searchEntities(client(() => new Response(bytes, { headers: { "content-type": "application/octet-stream", "content-length": "16" } })), query), EntityReadError);
 await assert.rejects(searchEntities(client(() => new Response(bytes, { headers: { "content-type": "application/octet-stream", "content-length": "16", "x-locus-search-no-filter": "true" } })), { ...query, text: "entity_id:*" }), EntityReadError);
});

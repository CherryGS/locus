import assert from "node:assert/strict";
import test from "node:test";
import { createLocusClient, searchEntities, EntityReadError } from "../src/index.js";
const id = "01992853-c123-7000-8000-000000000001";
const bytes = Uint8Array.from(Buffer.from(id.replaceAll("-", ""), "hex"));
const headers = { "content-type": "application/octet-stream", "content-length": "16", "x-locus-search-context": id, "x-locus-search-generation": id, "x-locus-search-sequence": "9223372036854775807", "x-locus-search-expires": "600" };
function client(response: () => Response) { return createLocusClient({ origin: "http://127.0.0.1:1", runId: "run" }, async (input, init) => { const request = new Request(input, init); assert.equal(request.headers.get("x-locus-run"), "run"); return request.url.endsWith("/release") ? new Response(null, { status: 204 }) : response(); }); }
test("search retains checked packed IDs and exact metadata through release", async () => {
  const result = await searchEntities(client(() => new Response(bytes, { headers })), { text: "", filter: null }); assert.equal(result.entities.at(0), id); assert.equal(result.coveredSequence, "9223372036854775807"); await result.release(); assert.equal(result.entities.byteLength, 16);
});
test("search rejects truncation, missing metadata and malformed identity", async () => {
  for (const override of [{ "content-length": "32" }, { "x-locus-search-context": "invalid" }, { "x-locus-search-expires": "0" }, { "x-locus-search-sequence": "9223372036854775808" }]) {
    await assert.rejects(searchEntities(client(() => new Response(bytes, { headers: { ...headers, ...override } })), { text: "", filter: null }), EntityReadError);
  }
  await assert.rejects(searchEntities(client(() => new Response(new Uint8Array(16), { headers })), { text: "", filter: null }), EntityReadError);
});

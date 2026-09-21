import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createLocusClient, EntityReadError, readEntityIds } from "../src/index.js";

const first = "01992853-c123-7000-8000-000000000001";
const second = "01992853-c123-7000-8000-000000000002";
const binary = (...ids: string[]) => Uint8Array.from(Buffer.from(ids.join("").replaceAll("-", ""), "hex"));
const context = { origin: "http://127.0.0.1:4321", runId: "test-run" };
function client(response: () => Response | Promise<Response>) {
  // Exercise the same caller-injected origin-scoped authorization composition as
  // the actual consumer, not a separately exported decoder.
  return createLocusClient(context, async (input, init) => {
    const request = new Request(input, init);
    assert.equal(new URL(request.url).origin, context.origin);
    request.headers.set("Authorization", "Bearer test-only");
    assert.equal(request.headers.get("Authorization"), "Bearer test-only");
    assert.equal(request.headers.get("X-Locus-Run"), context.runId);
    assert.equal(new URL(request.url).pathname, "/api/v1/entities");
    assert.equal(request.method, "GET");
    return response();
  });
}
function response(bytes = binary(first, second), headers: Record<string, string> = {}) {
  return new Response(bytes, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bytes.length), ...headers } });
}

test("valid, zero-length and refreshed sequences retain compact identities", async () => {
  let result = () => response();
  const configured = client(() => result());
  const prior = await readEntityIds(configured);
  assert.equal(prior.length, 2); assert.equal(prior.byteLength, 32);
  assert.equal(prior.at(0), first); assert.equal(prior.at(1), second);
  for (const position of [-1, 2, 0.5, NaN, Infinity]) assert.equal(prior.at(position), undefined);
  assert.equal(prior.indexOf(first), 0); assert.equal(prior.indexOf(second), 1);
  assert.equal(prior.indexOf("invalid"), -1);
  assert.equal(prior.indexOf(first.toUpperCase()), -1);
  result = () => response(binary(second));
  const fresh = await readEntityIds(configured);
  assert.equal(fresh.length, 1); assert.equal(fresh.at(0), second);
  assert.equal(prior.at(0), first); assert.equal(prior.length, 2);
  result = () => response(new Uint8Array());
  const empty = await readEntityIds(configured);
  assert.equal(empty.length, 0); assert.equal(empty.byteLength, 0); assert.equal(empty.indexOf(first), -1);
  result = () => response(binary(second), { "Content-Length": "32" });
  await assert.rejects(readEntityIds(configured), EntityReadError);
  assert.equal(prior.at(1), second); assert.equal(fresh.at(0), second);
});

test("completion, type, length, alignment and UUID validity are required", async () => {
  const missing = response(); missing.headers.delete("Content-Length");
  const wrongVersion = binary(first); wrongVersion[6] = 0x40;
  const wrongVariant = binary(first); wrongVariant[8] = 0xc0;
  const cases = [
    missing,
    response(binary(first), { "Content-Type": "application/json" }),
    response(binary(first), { "Content-Length": "" }),
    response(binary(first), { "Content-Length": "-16" }),
    response(binary(first), { "Content-Length": "16.0" }),
    response(binary(first), { "Content-Length": "1e1" }),
    response(binary(first), { "Content-Length": "9007199254740992" }),
    response(binary(first), { "Content-Length": "32" }), // complete-ID prefix
    response(binary(first), { "Content-Length": "0" }), // library skipped parsing
    response(new Uint8Array(17)), response(wrongVersion), response(wrongVariant),
    new Response(null, { status: 204 }),
  ];
  for (const malformed of cases) await assert.rejects(readEntityIds(client(() => malformed)), EntityReadError);
});

test("typed HTTP errors and fetch/stream errors never become empty success", async () => {
  const failure = { code: "wrong_run", message: "run changed", diagnostic: null };
  const configured = client(() => new Response(JSON.stringify(failure), { status: 409, headers: { "Content-Type": "application/json" } }));
  await assert.rejects(readEntityIds(configured), error => {
    assert(error instanceof EntityReadError);
    assert.equal(error.response.status, 409); assert.deepEqual(error.apiError, failure); return true;
  });
  await assert.rejects(readEntityIds(client(() => { throw new Error("network failed"); })), /network failed/);
  let reads = 0;
  const body = new ReadableStream({ pull(controller) {
    if (reads++ === 0) controller.enqueue(binary(first)); else controller.error(new Error("late stream failure"));
  } });
  await assert.rejects(readEntityIds(client(() => new Response(body, { headers: { "Content-Type": "application/octet-stream", "Content-Length": "32" } }))), /late stream failure/);
});

test("real truncated HTTP ending on a complete identity is rejected", async () => {
  const server = createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer real-test");
    assert.equal(request.headers["x-locus-run"], "real-run");
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": "32", Connection: "close" });
    response.end(binary(first));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const configured = createLocusClient({ origin, runId: "real-run" }, async (input, init) => {
      const request = new Request(input, init); assert.equal(new URL(request.url).origin, origin);
      request.headers.set("Authorization", "Bearer real-test");
      return fetch(new Request(request, { redirect: "error", signal: AbortSignal.timeout(3000) }));
    });
    await assert.rejects(readEntityIds(configured));
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

import type { LocusClient } from "./client.js";
import type { components } from "./schema.js";

/** One complete immutable observation. Basic enumeration order can change on
 * refresh; search retains its declared ordering. UUID strings are created on demand. */
export interface EntitySequence {
  readonly length: number;
  readonly byteLength: number;
  /** O(1); returns undefined for an out-of-range or noninteger position. */
  at(position: number): string | undefined;
  /** O(n) scan of binary IDs without an auxiliary index. Invalid IDs return -1. */
  indexOf(entityId: string): number;
}

export class EntityReadError extends Error {
  constructor(message: string, readonly response: Response, readonly apiError?: components["schemas"]["ApiError"]) {
    super(message);
    this.name = "EntityReadError";
  }
}

const hex = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, "0"));
const canonicalV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class PackedEntities implements EntitySequence {
  // No external view of the backing buffer: refresh and caller mutation cannot
  // change an established sequence. The received buffer is adopted, not copied.
  readonly #bytes: Uint8Array;
  readonly #words: Uint32Array;
  constructor(buffer: ArrayBuffer) {
    this.#bytes = new Uint8Array(buffer);
    this.#words = new Uint32Array(buffer);
  }
  get length() { return this.#bytes.byteLength / 16; }
  get byteLength() { return this.#bytes.byteLength; }
  at(position: number): string | undefined {
    if (!Number.isInteger(position) || position < 0 || position >= this.length) return undefined;
    const offset = position * 16;
    let id = "";
    for (let i = 0; i < 16; i++) {
      if (i === 4 || i === 6 || i === 8 || i === 10) id += "-";
      id += hex[this.#bytes[offset + i]];
    }
    return id;
  }
  indexOf(entityId: string): number {
    if (!canonicalV7.test(entityId)) return -1;
    const compact = entityId.replaceAll("-", "");
    const target = new Uint8Array(16);
    for (let i = 0; i < 16; i++) target[i] = Number.parseInt(compact.slice(i * 2, i * 2 + 2), 16);
    // Both views use native endianness solely for equality. Four words avoid
    // sixteen byte comparisons without copying IDs or retaining a lookup index.
    const words = new Uint32Array(target.buffer);
    const [a, b, c, d] = words;
    for (let offset = 0; offset < this.#words.length; offset += 4) {
      if (this.#words[offset] === a && this.#words[offset + 1] === b &&
          this.#words[offset + 2] === c && this.#words[offset + 3] === d) return offset / 4;
    }
    return -1;
  }
}

/** Consume the generated route through the configured client (including injected
 * authorization/run context), then validate the entire result before publishing it.
 * Each call returns a new observation; failure leaves previous sequences intact. */
export async function readEntityIds(client: LocusClient, options: { signal?: AbortSignal } = {}): Promise<EntitySequence> {
  const { data, error, response } = await client.GET("/api/v1/entities", { parseAs: "arrayBuffer", signal: options.signal });
  return decodeEntityResponse(response, data, error);
}

/** Shared packed UUIDv7 decoder for complete enumeration and search results. */
export async function decodeEntityResponse(response: Response, data?: ArrayBuffer, error?: components["schemas"]["ApiError"]): Promise<EntitySequence> {
  const fail = (message: string): never => { throw new EntityReadError(message, response, error); };
  if (response.status !== 200) fail(`Entity enumeration failed with HTTP ${response.status}`);
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/octet-stream") fail("Expected application/octet-stream");
  const declared = response.headers.get("content-length");
  if (declared === null || !/^(0|[1-9][0-9]*)$/.test(declared)) fail("Missing or invalid Content-Length");
  const length = Number(declared);
  if (!Number.isSafeInteger(length)) fail("Content-Length exceeds exact integer range");
  // openapi-fetch skips parsing when Content-Length is 0. Consume that response
  // too: an injected fetch returning a false zero-length body must not pass.
  const buffer = data ?? await response.arrayBuffer();
  if (buffer.byteLength !== length) fail("Incomplete Entity enumeration: byte count differs from Content-Length");
  if (length % 16 !== 0) fail("Entity enumeration is not aligned to 16-byte identities");
  const bytes = new Uint8Array(buffer);
  for (let offset = 0; offset < bytes.length; offset += 16) {
    if ((bytes[offset + 6] & 0xf0) !== 0x70 || (bytes[offset + 8] & 0xc0) !== 0x80) fail(`Invalid RFC UUIDv7 at position ${offset / 16}`);
  }
  return new PackedEntities(buffer);
}

import type { LocusClient } from "./client.js";
import type { components } from "./schema.js";
import { decodeEntityResponse, EntityReadError, type EntitySequence } from "./entities.js";

export interface SearchObservation {
  readonly entities: EntitySequence;
  readonly context: string;
  readonly generation: string;
  readonly coveredSequence: string;
  readonly expiresAfterSeconds: number;
  /** Releasing evidence does not modify the completed identity sequence. */
  release(): Promise<void>;
}

/** Completes and validates the whole identity transfer before returning any result. */
export async function searchEntities(client: LocusClient, query: components["schemas"]["SearchQueryBody"], options: { signal?: AbortSignal } = {}): Promise<SearchObservation> {
  const { data, error, response } = await client.POST("/api/v1/search/query", { body: query, parseAs: "arrayBuffer", signal: options.signal });
  const entities = await decodeEntityResponse(response, data, error);
  const fail = (message: string): never => { throw new EntityReadError(message, response); };
  const context = response.headers.get("x-locus-search-context") ?? fail("Missing search context");
  const generation = response.headers.get("x-locus-search-generation") ?? fail("Missing search generation");
  const coveredSequence = response.headers.get("x-locus-search-sequence") ?? fail("Missing search sequence");
  const expiry = response.headers.get("x-locus-search-expires") ?? fail("Missing context expiry");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (!uuid.test(context) || !uuid.test(generation)) fail("Invalid search observation identity");
  if (!/^(0|[1-9][0-9]*)$/.test(coveredSequence) || BigInt(coveredSequence) > 9223372036854775807n) fail("Invalid journal sequence");
  if (!/^[1-9][0-9]*$/.test(expiry) || !Number.isSafeInteger(Number(expiry))) fail("Invalid context expiry");
  return Object.freeze({ entities, context, generation, coveredSequence, expiresAfterSeconds: Number(expiry), async release() {
    const { response, error } = await client.POST("/api/v1/search/release", { body: { context } });
    if (response.status !== 204) throw new EntityReadError("Search context release failed", response, error);
  } });
}

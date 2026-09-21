import createClient from "openapi-fetch";
import type { components, paths } from "./schema.js";

export interface BackendContext {
  origin: string;
  runId: string;
}

// Only the factory-managed header is removed from per-call requirements.
// Generated paths stay unmodified and exported; bodies, path/query parameters,
// statuses and responses keep the full generated contract.
type ConfiguredOperation<T> = T extends { parameters: infer P }
  ? P extends { header: infer H }
    ? Omit<T, "parameters"> & {
        parameters: Omit<P, "header"> & {
          header?: Omit<H, "X-Locus-Run"> & { "X-Locus-Run"?: never };
        };
      }
    : T
  : T;
type ConfiguredPaths = {
  [P in keyof paths]: { [M in keyof paths[P]]: ConfiguredOperation<paths[P][M]> };
};

/** The host supplies authorization through fetch/header interception for this
 * exact origin. This factory has no credential, replay, retry, or run discovery. */
export function createLocusClient(context: BackendContext, fetch?: typeof globalThis.fetch) {
  return createClient<ConfiguredPaths>({
    baseUrl: context.origin,
    headers: { "X-Locus-Run": context.runId },
    fetch,
  });
}

export type LocusClient = ReturnType<typeof createLocusClient>;

export type { components, paths } from "./schema.js";
export type TaskSnapshot = components["schemas"]["TaskSnapshot"];
export type TaskOutcome = components["schemas"]["TaskOutcome"];
/** Compatibility name; task results now also include Media operations. */
export type ImportOutcome = TaskOutcome;

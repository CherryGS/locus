import type { BackendContext } from "./client.js";
import type { components } from "./schema.js";

/** Raw bytes adapter for the generated upload contract. The supplied transport
 * owns bearer authorization, just as it does for createLocusClient. */
export async function uploadFile(
  context: BackendContext,
  metadata: components["schemas"]["UploadMetadata"],
  body: NonNullable<NonNullable<Parameters<typeof globalThis.fetch>[1]>["body"]>,
  transport: typeof fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<components["schemas"]["Submission"]> {
  const query = new URLSearchParams({ request_id: metadata.request_id, byte_count: metadata.byte_count });
  if (metadata.filename != null) query.set("filename", metadata.filename);
  const init: RequestInit & { duplex?: "half" } = {
    method: "POST", body, signal,
    headers: { "Content-Type": "application/octet-stream", "X-Locus-Run": context.runId },
  };
  if (body instanceof ReadableStream) init.duplex = "half";
  const response = await transport(new URL(`/external/v1/uploads?${query}`, context.origin), init);
  if (!response.ok) {
    const detail = await response.json() as components["schemas"]["ApiError"];
    throw new UploadDeliveryError(response.status, detail);
  }
  return await response.json() as components["schemas"]["Submission"];
}
export class UploadDeliveryError extends Error {
  constructor(readonly status: number, readonly detail: components["schemas"]["ApiError"]) {
    super(detail.message);
    this.name = "UploadDeliveryError";
  }
}

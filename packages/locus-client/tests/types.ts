import { createLocusClient } from "../src/index.js";
import type { components } from "../src/index.js";

// Compiled but never executed. Removing a contract constraint makes tsc fail
// because each @ts-expect-error must correspond to a real type error.
async function contracts() {
  const client = createLocusClient({ origin: "http://127.0.0.1:1234", runId: "run" });
  // @ts-expect-error File import requires both request_id and source_path.
  await client.POST("/api/v1/imports", { body: { source_path: "/input" } });
  // @ts-expect-error Request identity is a string, not a number.
  await client.POST("/api/v1/imports", { body: { request_id: 7, source_path: "/input" } });
  // @ts-expect-error Unsupported paths do not compile.
  await client.GET("/api/v1/arbitrary-files");
  // @ts-expect-error The factory's run context cannot be replaced per call.
  await client.GET("/api/v1/server", { params: { header: { "X-Locus-Run": "another-run" } } });
  // @ts-expect-error File metadata lookup still requires its path identity.
  await client.GET("/api/v1/files/{file_id}");
  const binary = await client.GET("/api/v1/entities", { parseAs: "arrayBuffer" });
  const bytes: ArrayBuffer | undefined = binary.data;
  const batch = await client.POST("/api/v1/memberships/read", { body: { entity_ids: ["entity"] } });
  if (batch.data?.[0].status === "present") console.log(batch.data[0].memberships);
  // @ts-expect-error A membership read requires its subset.
  await client.POST("/api/v1/memberships/read", { body: {} });
  // @ts-expect-error No query pagination contract was introduced.
  await client.GET("/api/v1/entities", { params: { query: { page: 1 } } });
  void bytes;
  const file: components["schemas"]["FileMetadata"] = {
    file_id: "id", kind_id: "kind", relative_path: "object/id",
    // @ts-expect-error Exact byte counts are decimal strings.
    byte_count: 9007199254740993,
  };
  const outcome = {} as components["schemas"]["TaskOutcome"];
  if (outcome.status === "failed") {
    // @ts-expect-error Failed admission does not imply a successful File record.
    console.log(outcome.file);
    console.log(outcome.diagnostic.kind, outcome.progress?.file_id);
  }
  const registered = await client.POST("/api/v1/registered-import-batches", { body: { request_id: "request", items: [{ twitter: { post_id: "123456789" } }, { file_id: "file" }] } });
  if (registered.data?.status === "accepted") console.log(registered.data.receipt.task_id);
  // @ts-expect-error Registered File identities are strings.
  const badFile: components["schemas"]["RegisteredImportItem"] = { file_id: 123 };
  void badFile;
  // @ts-expect-error Captures do not supply mutable local record revisions.
  const badSnapshot: components["schemas"]["TwitterSnapshot"] = { post_id: "123456789", revision: "7" };
  void badSnapshot;
  return file;
}
void contracts;

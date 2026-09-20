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
  const file: components["schemas"]["FileMetadata"] = {
    file_id: "id", relative_path: "object/id",
    // @ts-expect-error Exact byte counts are decimal strings.
    byte_count: 9007199254740993,
  };
  const outcome = {} as components["schemas"]["ImportOutcome"];
  if (outcome.status === "failed") {
    // @ts-expect-error Failed admission does not imply a successful File record.
    console.log(outcome.file);
    console.log(outcome.diagnostic.kind, outcome.progress?.file_id);
  }
  return file;
}
void contracts;

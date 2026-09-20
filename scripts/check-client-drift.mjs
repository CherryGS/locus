import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "locus-client-drift-"));
function run(program, args) {
  const result = spawnSync(program, args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || "Generation failed");
}
try {
  const binary = join(root, "target", "debug", process.platform === "win32" ? "locus-server.exe" : "locus-server");
  const first = join(temporary, "first.json");
  const second = join(temporary, "second.json");
  run(binary, ["export-openapi", first]);
  run(binary, ["export-openapi", second]);
  const schema = await readFile(first, "utf8");
  if (schema !== await readFile(second, "utf8")) throw new Error("OpenAPI export is not deterministic");
  if (schema !== await readFile(join(root, "packages/locus-client/openapi.json"), "utf8")) throw new Error("Checked-in OpenAPI has drifted; run just client-generate");
  const generated = join(temporary, "schema.d.ts");
  run(process.execPath, [join(root, "packages/locus-client/node_modules/openapi-typescript/bin/cli.js"), first, "--output", generated]);
  if (await readFile(generated, "utf8") !== await readFile(join(root, "packages/locus-client/src/schema.d.ts"), "utf8")) throw new Error("Generated client has drifted; run just client-generate");
  console.log("OpenAPI deterministic; checked-in schema and TypeScript match regeneration.");
} finally {
  if (!resolve(temporary).startsWith(resolve(tmpdir()) + "/") && !resolve(temporary).startsWith(resolve(tmpdir()) + "\\")) throw new Error("Unexpected temporary path");
  await rm(temporary, { recursive: true, force: true });
}

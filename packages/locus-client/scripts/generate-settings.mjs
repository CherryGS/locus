import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";
import { pathToFileURL } from "node:url";

// A lossy JS parse must fail before producing a default factory. This also rejects
// decimal representations whose JSON round trip would discard significant digits.
function decimal(source) {
  const [base, exponent = "0"] = source.toLowerCase().split("e");
  const [integer, fraction = ""] = base.split(".");
  let digits = BigInt(integer + fraction);
  let scale = BigInt(exponent) - BigInt(fraction.length);
  if (digits === 0n) return "0";
  while (digits % 10n === 0n) { digits /= 10n; scale++; }
  return `${digits}e${scale}`;
}
export function parseExact(text) {
  return JSON.parse(text, (key, value, context) => {
    if (typeof value === "number") {
      if (!context?.source) throw new Error("Exact default export requires JSON.parse source context");
      if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)) || decimal(context.source) !== decimal(JSON.stringify(value)))
        throw new Error(`Unsupported numeric representation: ${context.source}`);
    }
    return value;
  });
}
export async function generate(input, output) {
  const definitions = parseExact(await readFile(input, "utf8"));
  const names = new Set(); const ids = new Set(); const symbols = new Set();
  let result = "// Generated from Rust provider schemas and complete defaults. Do not edit.\n";
  for (const definition of definitions) {
    const { name, group_id, schema, defaults } = definition;
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name) || names.has(name) || ids.has(group_id)) throw new Error(`Conflicting or invalid settings definition: ${name}`);
    names.add(name); ids.add(group_id);
    const compiled = await compile({ ...schema, title: name }, name, { bannerComment: "", format: true, additionalProperties: false });
    const emitted = [...compiled.matchAll(/export (?:interface|type|enum) ([A-Za-z_$][A-Za-z0-9_$]*)/g)].map(match => match[1]);
    emitted.push(`${name}GroupId`, `create${name}Defaults`);
    for (const symbol of emitted) {
      if (symbols.has(symbol)) throw new Error(`Conflicting generated symbol: ${symbol}`);
      symbols.add(symbol);
    }
    result += compiled;
    // JSON.parse preserves keys such as __proto__ exactly and creates fresh nested
    // objects/arrays on every call. Runtime type is checked by generated contracts.
    result += `export const ${name}GroupId = ${JSON.stringify(group_id)};\n`;
    result += `export function create${name}Defaults(): ${name} { return JSON.parse(${JSON.stringify(JSON.stringify(defaults))}); }\n`;
  }
  await writeFile(output, result);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await generate(process.argv[2] ?? "settings.json", process.argv[3] ?? "src/settings.ts");

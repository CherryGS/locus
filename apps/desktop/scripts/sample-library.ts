import { readFile, writeFile } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { workspace, startServer } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { generateSampleLibrary } from "./sample-library-generate.ts"
import type { Manifest } from "./sample-library-session.ts"

const [command, output, ...rest] = process.argv.slice(2)
const root = output
  ? isAbsolute(output)
    ? resolve(output)
    : resolve(workspace, output)
  : join(workspace, ".local", "comprehensive-library")
if (command === "generate") {
  if (rest.length && (rest[0] !== "--real-inputs" || !rest[1] || rest.length !== 2))
    throw new Error("Expected --real-inputs <directory>")
  const manifest = await generateSampleLibrary(
    root,
    rest[1] ? resolve(workspace, rest[1]) : undefined,
  )
  console.log(
    JSON.stringify({ root, library: manifest.library, cases: manifest.cases.length }, null, 2),
  )
} else if (command === "verify") {
  const { verifySampleLibrary } = await import("./sample-library-verify.ts")
  await verifySampleLibrary(root)
} else if (command === "extend-civitai") {
  const { extendCivitaiSamples } = await import("./sample-library-civitai.ts")
  await extendCivitaiSamples(root)
} else if (command === "verify-civitai") {
  const { verifyCivitaiSamples } = await import("./sample-library-civitai.ts")
  await verifyCivitaiSamples(root)
} else if (command === "preview") {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as Manifest
  const backend = await startServer(manifest.library, undefined, manifest.providerConfig, true)
  let preview: Awaited<ReturnType<typeof browserPreview>> | undefined
  try {
    const port = rest[0] === "--port" ? Number(rest[1]) : 0
    if (rest.length && (rest[0] !== "--port" || rest.length !== 2 || !Number.isInteger(port) || port < 1 || port > 65535))
      throw new Error("Expected --port <1..65535>")
    preview = await browserPreview(backend, port)
    const origin = preview.origin
    const guide = join(root, "preview.md")
    await writeFile(
      guide,
      `# Running sample preview\n\nThese links apply only to this preview run. **Open case links in a new tab** to start a fresh viewing context. A direct hash-only switch inside an existing Civitai excursion can retain the previous model selection; this fixture does not change that product behavior.\n\n[Open library](${origin}/#/entity)\n\n${manifest.cases.map((e) => `- [${e.name}](${origin}/#/entity?mode=inspect&entityId=${e.entityId}) — ${e.expected}`).join("\n")}\n`,
    )
    console.log(
      JSON.stringify(
        {
          preview: preview.origin + "/#/entity",
          library: manifest.library,
          manifest: join(root, "README.md"),
          guide,
        },
        null,
        2,
      ),
    )
    let stopping = false
    const stop = async () => {
      if (stopping) return
      stopping = true
      try {
        await preview?.close()
      } finally {
        await backend.stop()
      }
    }
    process.once("SIGINT", () => void stop())
    process.once("SIGTERM", () => void stop())
  } catch (error) {
    try {
      await preview?.close()
    } finally {
      await backend.stop()
    }
    throw error
  }
} else
  throw new Error(
    "Usage: sample-library.ts generate|verify|extend-civitai|verify-civitai|preview [output-root] [--real-inputs directory | --port number]",
  )

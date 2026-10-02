import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { createAssets, type ProviderConfig, type ProviderModel } from "./sample-library-assets.ts"
import { seedSampleTags } from "./sample-library-tags.ts"
import {
  sampleSession,
  type Manifest,
  type SampleCase,
  type Wire,
} from "./sample-library-session.ts"

export async function generateSampleLibrary(root: string, realInputs?: string): Promise<Manifest> {
  // Never reset: a failed generation is preserved for diagnosis and needs a new root.
  root = resolve(root)
  await mkdir(root, { recursive: true })
  assert.equal((await readdir(root)).length, 0, "Refusing nonempty sample output: " + root)
  await writeFile(join(root, "generation.json"), JSON.stringify({ state: "generating", root }))
  const assets = await createAssets(join(root, "inputs", "synthetic"))
  const config = JSON.parse(await readFile(assets.seed.config, "utf8")) as ProviderConfig
  const configPath = join(root, "inputs", "provider.json")
  const examples = Object.entries(assets.images)
    .slice(0, 3)
    .map(([name, path], i) => {
      const url = `https://image.civitai.com/controlled/${name}.png`
      config.examples[url] = path
      return {
        id: 901 + i,
        url,
        type: "image",
        width: [960, 360, 480][i],
        height: [540, 640, 480][i],
      }
    })
  for (const item of assets.seed.cases) {
    const match = config.lookups[item.hash]
    match.images = structuredClone(examples)
    item.model.modelVersions[0].images = structuredClone(examples)
    if (item.name === "A")
      item.model.modelVersions[1].images = [
        {
          id: 999,
          type: "image",
          url: "https://example.invalid/listed-not-admitted.png",
        },
      ]
    // Fourth input deliberately uses an overlapping version number in another model.
    if (item.name === "existing") {
      match.modelId = 2
      match.images = []
      item.model.id = 2
      item.model.name = "Separate model · empty examples"
      item.model.modelVersions = [structuredClone(match)]
    }
  }
  await writeFile(configPath, JSON.stringify(config, null, 2))
  const real = join(root, "inputs", "retained")
  if (realInputs) {
    // Validate the supplied provenance before copying; neither old metadata nor
    // acquisition-time task receipts are used as domain state.
    const inputs = JSON.parse(await readFile(join(realInputs, "input-manifest.json"), "utf8")) as {
      path: string
      bytes: number
      sha256: string
    }[]
    for (const input of inputs) {
      const source = resolve(realInputs, input.path)
      const within = relative(resolve(realInputs), source)
      assert(!within.startsWith("..") && !isAbsolute(within), "Input escapes retained root")
      const bytes = await readFile(source)
      assert.equal(bytes.length, input.bytes, input.path)
      assert.equal(createHash("sha256").update(bytes).digest("hex"), input.sha256, input.path)
      const destination = join(real, input.path)
      await mkdir(resolve(destination, ".."), { recursive: true })
      await cp(source, destination)
    }
    await cp(join(realInputs, "input-manifest.json"), join(real, "input-manifest.json"))
  }
  const manifest: Manifest = {
    format: 1,
    root,
    library: join(root, "library"),
    providerConfig: configPath,
    createdAt: new Date().toISOString(),
    cases: [],
    retainedInputs: !!realInputs,
    notes: [
      "Fresh current-schema library. All payloads were admitted through typed APIs; no SQL seed or old database is reused.",
      "Synthetic source URLs are observations only. Generation and verification need no network or credentials.",
      "Identical weights remain independent Files. Civitai example reuse is contributor-qualified; Bilibili covers are independent even when their bytes match.",
      "File-only cards use their ordinary identity fallback. Case names here are documentation, not new stored display fields.",
      "Provider and task results below record generation-time evidence; tasks are run-local. Reopen checks read retained domain facts.",
      "Personal Tags cover mixed direct/inclusive content, Markdown, empty/Unicode records, and wide/deep branches. sample:verify includes Tag renderer checks.",
    ],
  }
  const session = await sampleSession(manifest.library, configPath)
  async function add(
    name: string,
    path: string | undefined,
    view: string,
    expected: string,
    source?: Parameters<typeof session.admit>[1],
    provenance: SampleCase["provenance"] = "synthetic",
  ) {
    console.log("Admitting " + name)
    const result = await session.admit(path, source)
    if (name === "bilibili/unavailable-cover")
      assert(!result.complete, "Invalid cover must remain incomplete")
    else assert(result.complete, `${name}: ${JSON.stringify(result)}`)
    const entry: SampleCase = {
      name,
      entityId: result.confirmed_entity_id!,
      fileId: result.confirmed_file_id ?? undefined,
      view,
      expected,
      provenance,
      input: path ? relative(root, path) : undefined,
      result,
    }
    await session.preference(entry.entityId, view)
    manifest.cases.push(entry)
    await writeFile(join(root, "manifest.partial.json"), JSON.stringify(manifest, null, 2))
    return entry
  }
  try {
    for (const name of ["document.txt", "metadata.json", "星空 — café.txt", "empty.bin"])
      await add(
        "file/" + name,
        assets.files[name],
        "file.info",
        "Admitted independent File; no recognized Media or Model kind",
      )
    for (const [name, path] of Object.entries(assets.images))
      await add(
        "image/" + name,
        path,
        "image.inspect",
        "Accepted image facts, managed original and generated preview",
      )
    await add(
      "image/unsupported",
      assets.files["unsupported.png"],
      "file.info",
      "Unrecognized bytes despite .png suffix; no invented Image success",
    )
    for (const [name, path] of Object.entries(assets.videos))
      await add(
        "video/" + name,
        path,
        "video.play",
        "Playable H.264/AAC; accepted metadata and generated local cover",
      )
    await add(
      "model/local-unmatched",
      assets.files["local.safetensors"],
      "model.read",
      "Accepted SafeTensors tensor/metadata inspection; Civitai no-match",
    )
    await add(
      "model/malformed",
      assets.files["malformed.safetensors"],
      "file.info",
      "Malformed container is not a successful Model inspection or provider match",
    )
    for (const name of ["A", "B", "C", "existing", "A-copy"]) {
      const item = assets.seed.cases.find((c) => c.name === (name === "A-copy" ? "A" : name))!
      config.models[String(item.model.id)] = item.model
      await writeFile(configPath, JSON.stringify(config, null, 2))
      const entry = await add(
        "civitai/" + name,
        item.path,
        "civitai.read",
        name === "existing"
          ? "Separate model 2, version 10, empty examples; does not contribute to model 1"
          : name.startsWith("A")
            ? "Origin model 1 version 10; listed version 20 has no local match; peer version 30 is absent from origin; independent equal weights share eligible previews"
            : "Model 1 version 30; independent source and matched remote file; shared eligible previews preserve contributors",
      )
      assert.equal(entry.result.civitai?.metadata, "accepted", JSON.stringify(entry.result))
      assert.equal(entry.result.civitai?.state, "complete", JSON.stringify(entry.result))
    }
    const post: Wire<"TwitterSnapshot"> = {
      post_id: "1900000000000000001",
      text: "Offline field notes · three independently captured media items from the same post",
      author: { display_name: "Synthetic observer", handle: "locus_fixture" },
      hashtags: ["offline", "sample"],
      observed_at_unix_ms: "1750000300000",
      published_at_unix_ms: "1750000000000",
    }
    for (const [i, name] of ["image-one", "image-two", "video"].entries())
      await add(
        "twitter/" + name,
        i === 2
          ? assets.videos.landscape
          : i === 0
            ? assets.images.landscape
            : assets.images.portrait,
        "twitter.read",
        "Same post, independent snapshot and media occurrence with matching File association",
        {
          twitter: {
            ...post,
            occurrence: {
              label: i === 2 ? "video" : "photo",
              source_order: i,
              media_id: String(710 + i),
            },
          },
        },
      )
    await add(
      "twitter/locator-only",
      undefined,
      "twitter.read",
      "Locator-only snapshot without File association",
      { twitter: { post_id: "1900000000000000002" } },
    )
    const changed = await add(
      "twitter/changed-file",
      assets.images.landscape,
      "twitter.read",
      "Retained snapshot basis differs from deliberately replaced current File",
      {
        twitter: {
          ...post,
          text: "Changed File association · retained original snapshot",
        },
      },
    )
    await session.replaceFile(changed, assets.images.portrait)
    const part = (i: number): Wire<"BilibiliSnapshot"> => ({
      bvid: "BV1xx411c7mD",
      title: "Synthetic multipart field guide",
      description: "Three independently captured parts; each has an independent original cover.",
      author: { user_id: "123", display_name: "Fixture studio" },
      part: {
        cid: String(8100 + i),
        number: i,
        title: ["", "Landscape and sound", "Portrait motion", "Square color study"][i],
        claims: { duration_ms: "4000" },
      },
      tags: ["synthetic", "multipart"],
      preview: { url: "https://example.invalid/shared-cover.png" },
    })
    for (const [i, path] of Object.values(assets.videos).entries())
      await add(
        `bilibili/part-${i + 1}`,
        path,
        "bilibili.read",
        "Matching local part and original cover; equal cover bytes have distinct Entity/File identities",
        { bilibili: part(i + 1), coverPath: assets.images.landscape },
      )
    await add(
      "bilibili/source-only",
      undefined,
      "bilibili.read",
      "Submission/part observation with cover but no local video association",
      {
        bilibili: { ...part(1), title: "Source-only submission" },
        coverPath: assets.images.landscape,
      },
    )
    await add(
      "bilibili/locator-only",
      undefined,
      "bilibili.read",
      "Only BV locator retained; no cover or video invented",
      { bilibili: { bvid: "BV1xx411c7mD" } },
    )
    await add(
      "bilibili/unavailable-cover",
      assets.videos.landscape,
      "bilibili.read",
      "Video remains playable; supplied cover bytes are unrecognized and cover processing is attributed as incomplete",
      {
        bilibili: { ...part(1), title: "Unavailable original cover" },
        coverPath: assets.files["unsupported.png"],
      },
    )
    if (realInputs) await addRetained(real, config, configPath, add)
    await seedSampleTags(session.server.client, manifest)
  } finally {
    await session.server.stop()
  }
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest, null, 2))
  await writeFile(
    join(root, "README.md"),
    `# Comprehensive retained library\n\nLibrary: \`${manifest.library}\`\n\n${manifest.notes.map((n) => "- " + n).join("\n")}\n\n## Cases\n\n${manifest.cases.map((e) => `### ${e.name}\n\n- Entity: \`${e.entityId}\`\n- File: \`${e.fileId ?? "none"}\`\n- View: \`${e.view}\`\n- Provenance: ${e.provenance}${e.input ? "; " + e.input : ""}\n- Expected: ${e.expected}\n- Import completed: ${e.result.complete}; outcome: ${e.result.overall}\n- Provider: \`${e.result.civitai?.component_id ?? e.result.bilibili?.component_id ?? e.result.twitter_id ?? "none"}\`\n`).join("\n")}\nFull confirmed component IDs, provider outcomes, previews and intentional failure evidence are in manifest.json. Reopen assertions and screenshots are in verification/.\n`,
  )
  await writeFile(
    join(root, "generation.json"),
    JSON.stringify({ state: "complete", cases: manifest.cases.length }),
  )
  return manifest
}

async function addRetained(
  real: string,
  config: ProviderConfig,
  configPath: string,
  add: (
    name: string,
    path: string | undefined,
    view: string,
    expected: string,
    source?: {
      twitter?: Wire<"TwitterSnapshot">
      bilibili?: Wire<"BilibiliSnapshot">
      coverPath?: string
    },
    provenance?: "synthetic" | "retained",
  ) => Promise<SampleCase>,
) {
  const asset = (name: string) => join(real, "assets", name)
  await add(
    "retained/NASA-cosmic-cliffs",
    asset("NASA-Cosmic-Cliffs.png"),
    "image.inspect",
    "Public NASA image with generated local preview",
    undefined,
    "retained",
  )
  await add(
    "retained/NASA-metadata",
    asset("NASA-Cosmic-Cliffs-Metadata.json"),
    "file.info",
    "Original NASA descriptive JSON retained as File",
    undefined,
    "retained",
  )
  await add(
    "retained/Sintel",
    asset("Sintel-Trailer.mp4"),
    "video.play",
    "Retained H.264/AAC trailer, metadata and generated cover",
    undefined,
    "retained",
  )
  const tweet = (
    JSON.parse(await readFile(join(real, "twitter.json"), "utf8")) as {
      tweet: {
        id: string
        url: string
        text: string
        author: { id: string; name: string; screen_name: string }
        media: {
          photos: {
            id: string
            url: string
            width: number
            height: number
            altText: string
          }[]
        }
      }
    }
  ).tweet
  const photo = tweet.media.photos[0]
  await add(
    "retained/NASAWebb-Twitter",
    asset("NASAWebb-First-Deep-Field.jpg"),
    "twitter.read",
    "Retained NASAWebb post observation and separately interpreted local image",
    {
      twitter: {
        post_id: tweet.id,
        page_url: tweet.url,
        text: tweet.text,
        author: {
          user_id: tweet.author.id,
          display_name: tweet.author.name,
          handle: tweet.author.screen_name,
        },
        occurrence: {
          media_id: photo.id,
          label: "photo",
          source_order: 0,
          alt_text: photo.altText,
        },
        representation: {
          url: photo.url,
          claims: { width: photo.width, height: photo.height },
        },
      },
    },
    "retained",
  )
  const model = JSON.parse(await readFile(join(real, "civitai.json"), "utf8")) as ProviderModel
  const version = structuredClone(model.modelVersions[0])
  version.modelId = model.id
  const hash = version.files[0].hashes.BLAKE3!
  config.models[String(model.id)] = model
  config.lookups[hash.toLowerCase()] = version
  const previews = JSON.parse(
    await readFile(join(real, "civitai-previews.json"), "utf8"),
  ) as Record<string, string>
  for (const [url, path] of Object.entries(previews)) config.examples[url] = join(real, path)
  await writeFile(configPath, JSON.stringify(config, null, 2))
  const weight = await add(
    "retained/EasyNegative",
    asset("EasyNegative.safetensors"),
    "civitai.read",
    "Real hash-matched model/version and four saved previews; listed PickleTensor version remains unmatched",
    undefined,
    "retained",
  )
  assert.equal(weight.result.civitai?.state, "complete", JSON.stringify(weight.result))
  type View = {
    bvid: string
    aid: number
    title: string
    desc: string
    pic: string
    pubdate: number
    owner: { mid: number; name: string }
    pages: { cid: number; page: number; part: string; duration: number }[]
  }
  for (const [prefix, filename, count] of [
    ["multipart", "multipart/view.json", 2],
    ["Big-Buck-Bunny", "bilibili.json", 1],
  ] as const) {
    const data = (JSON.parse(await readFile(join(real, filename), "utf8")) as { data: View }).data
    for (let i = 0; i < count; i++) {
      const p = data.pages[i]
      await add(
        `retained/bilibili-${prefix}-${i + 1}`,
        prefix === "multipart"
          ? join(real, "multipart", `part-${i + 1}.mp4`)
          : asset("Big-Buck-Bunny-BV15z4y1U7HS.mp4"),
        "bilibili.read",
        "Actual retained part and independently admitted original cover",
        {
          bilibili: {
            bvid: data.bvid,
            aid: String(data.aid),
            title: data.title,
            description: data.desc,
            published_at_unix_ms: String(data.pubdate * 1000),
            author: {
              user_id: String(data.owner.mid),
              display_name: data.owner.name,
            },
            part: {
              cid: String(p.cid),
              number: p.page,
              title: p.part,
              claims: { duration_ms: String(p.duration * 1000) },
            },
            preview: { url: data.pic },
          },
          coverPath:
            prefix === "multipart"
              ? join(real, "multipart", `cover-${i + 1}.jpg`)
              : asset("Big-Buck-Bunny-Original-Cover.jpg"),
        },
        "retained",
      )
    }
  }
}

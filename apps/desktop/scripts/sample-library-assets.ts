import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { deflateSync } from "node:zlib"
import { workspace } from "./fixture.ts"

export type ProviderImage = {
  id?: number
  url: string
  type: string
  width?: number
  height?: number
}
export type ProviderVersion = {
  id: number
  modelId?: number
  name: string
  description?: string
  baseModel?: string
  trainedWords?: string[]
  files: {
    id: number
    name: string
    type: string
    hashes: { BLAKE3?: string }
    sizeKB?: number
    metadata?: { format?: string; fp?: string }
  }[]
  images: ProviderImage[]
}
export type ProviderModel = {
  id: number
  name: string
  type: string
  description?: string
  tags: string[]
  modelVersions: ProviderVersion[]
}
export type ProviderConfig = {
  lookups: Record<string, ProviderVersion>
  models: Record<string, ProviderModel>
  examples: Record<string, string>
}
export type WeightSeed = {
  config: string
  cases: { name: string; path: string; hash: string; model: ProviderModel }[]
}
const execute = promisify(execFile)

// Deterministic RGBA artwork makes aspect ratios and independent specimens visible.
function artwork(width: number, height: number, style: number) {
  const chunk = (name: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(name), data])
    let crc = 0xffffffff
    for (const byte of body) {
      crc ^= byte
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    const size = Buffer.alloc(4),
      check = Buffer.alloc(4)
    size.writeUInt32BE(data.length)
    check.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([size, body, check])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const pixels = Buffer.alloc((width * 4 + 1) * height)
  const palettes = [
    [25, 110, 170],
    [150, 65, 125],
    [25, 150, 125],
    [225, 150, 35],
  ]
  const color = palettes[style % palettes.length]
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x / width,
        v = y / height
      const circle = (u - 0.68) ** 2 + (v - 0.28) ** 2 < 0.025
      const stripe = v > 0.7 + 0.08 * Math.sin(u * 12 + style)
      const rgb = circle
        ? [245, 224, 160]
        : stripe
          ? [18, 34, 63]
          : color.map((c) => Math.round(c * (0.65 + 0.35 * u)))
      pixels.set(
        [...rgb, style === 2 && u < 0.2 && v < 0.2 ? 0 : 255],
        y * (width * 4 + 1) + 1 + x * 4,
      )
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

export async function createAssets(root: string) {
  await mkdir(root, { recursive: true })
  const imageSpecs = [
    ["landscape", 960, 540],
    ["portrait", 360, 640],
    ["transparent-square", 480, 480],
    ["tiny", 16, 16],
  ] as const
  const images: Record<string, string> = {}
  for (const [i, [name, w, h]] of imageSpecs.entries()) {
    images[name] = join(root, name + ".png")
    await writeFile(images[name], artwork(w, h, i))
  }
  const videos: Record<string, string> = {}
  for (const [i, [name, size]] of [
    ["landscape", "640x360"],
    ["portrait", "360x640"],
    ["square", "360x360"],
  ].entries()) {
    videos[name] = join(root, name + ".mp4")
    await execute(
      process.env.LOCUS_FFMPEG ?? "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=${size}:rate=24`,
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${330 + i * 110}:sample_rate=44100`,
        "-t",
        "4",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        videos[name],
      ],
      { windowsHide: true, timeout: 60_000 },
    )
  }
  const files: Record<string, string> = {}
  for (const [name, content] of Object.entries({
    "document.txt":
      "Locus retained sample library\nOrdinary text with no Media or Model interpretation.\n",
    "metadata.json": JSON.stringify(
      { specimen: "offline", tags: ["sample", "document"], version: 1 },
      null,
      2,
    ),
    "星空 — café.txt": "Unicode filename specimen: 星空 · café · 🌌\n",
    "empty.bin": "",
    "unsupported.png": "This deliberately is not a decodable image.",
    "malformed.safetensors": "Not a SafeTensors container.",
  })) {
    files[name] = join(root, name)
    await writeFile(files[name], content)
  }
  const header = Buffer.from(
    JSON.stringify({
      __metadata__: {
        name: "Local unmatched sample",
        description: "Intrinsic tensor inspection without a provider match",
      },
      "encoder.weight": { dtype: "F32", shape: [2, 2], data_offsets: [0, 16] },
    }),
  )
  const length = Buffer.alloc(8)
  length.writeBigUInt64LE(BigInt(header.length))
  files["local.safetensors"] = join(root, "local.safetensors")
  await writeFile(files["local.safetensors"], Buffer.concat([length, header, Buffer.alloc(16)]))
  const helper = process.env.LOCUS_CIVITAI_INPUTS_BINARY
  const weights = join(root, "weights")
  const result = await execute(
    helper ?? "just",
    helper ? [weights] : ["server-civitai-inputs", weights],
    { cwd: workspace, windowsHide: true, timeout: 120_000 },
  )
  const seed = JSON.parse(result.stdout) as WeightSeed
  return { images, videos, files, seed }
}

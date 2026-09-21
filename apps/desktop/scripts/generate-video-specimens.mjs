import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Entirely synthetic, silent fixtures. Keep media under the dev-only route import
// so production builds do not ship demo videos or require ffmpeg at runtime.
const directory = new URL("../src/renderer/app/preview/media/", import.meta.url)
mkdirSync(directory, { recursive: true })
const ffmpeg = process.env.LOCUS_FFMPEG ?? "ffmpeg"
for (const [name, size] of [["landscape", "960x540"], ["portrait", "540x960"]]) {
  const video = fileURLToPath(new URL(`${name}.mp4`, directory))
  const poster = fileURLToPath(new URL(`${name}.webp`, directory))
  execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=c=0x253d48:s=${size}:r=24:d=8`,
    "-f", "lavfi", "-i", "color=c=0xd3c8a1:s=96x96:r=24:d=8",
    "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
    "-filter_complex", "[0:v]drawgrid=w=120:h=120:t=1:c=0x789b9b@0.2[base];[base][1:v]overlay=x='(W-w)*(0.5+0.35*sin(t))':y='(H-h)*(0.5+0.35*cos(t))':shortest=1[scene]",
    "-map", "[scene]", "-map", "2:a", "-t", "8",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26",
    "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", video,
  ], { stdio: "inherit", windowsHide: true })
  execFileSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", video,
    "-frames:v", "1", "-vf", "scale=480:480:force_original_aspect_ratio=decrease", poster,
  ], { stdio: "inherit", windowsHide: true })
}

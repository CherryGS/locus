import type { EntityItem } from "@/entities/entity"

// Synthetic, offline UI specimens. The route imports this module only in dev;
// none of these records or thumbnails enter the production renderer bundle.
const palettes = [
  ["#253d48", "#789b9b", "#d3c8a1"],
  ["#343847", "#73738b", "#c6a2a0"],
  ["#403d33", "#8c9074", "#d2c5a6"],
  ["#3d3338", "#9b7974", "#d1bda4"],
]

const specimens = palettes.flatMap(([background, foreground, accent]) => (
  [[1200, 800], [800, 1200]].map(([width, height]) => ({
    width,
    height,
    thumbnail: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${background}"/><circle cx="${width * .72}" cy="${height * .28}" r="${width * .12}" fill="${accent}"/><path d="M0 ${height * .8} L${width * .38} ${height * .35} L${width} ${height * .92} V${height} H0Z" fill="${foreground}"/><path d="M0 ${height * .94} L${width * .65} ${height * .6} L${width} ${height * .82} V${height} H0Z" fill="${accent}" opacity=".35"/></svg>`)}`,
  }))
))

export const previewEntities: readonly EntityItem[] = Array.from({ length: 240 }, (_, index) => {
  const number = String(index + 1).padStart(3, "0")
  // One long-name/UUID specimen exercises narrow inspector layouts.
  const id = index === 1 ? "01995c68-7200-7000-8000-000000000002" : `sample-${number}`
  if ((index + 1) % 13 === 0) return { id, name: `Sample ${number}`, components: [] }
  const fileOnly = (index + 1) % 7 === 0
  const name = index === 1
    ? "Sample 002 — coastline-study_evening-light_colour-and-texture-references_final-version.png"
    : `Sample ${number}.${fileOnly ? "txt" : "png"}`
  const specimen = specimens[index % specimens.length]
  return {
    id,
    name,
    components: [
      {
        kind: "file", id: `${id}-file`, originalName: name,
        bytes: fileOnly ? 2048 : 240000 + index * 3120,
        importedAt: new Date(Date.UTC(2026, 8, 20, 2) + index * 60_000).toISOString(),
      },
      ...(fileOnly ? [] : [{
        kind: "image" as const, id: `${id}-image`, format: "PNG",
        width: specimen.width, height: specimen.height,
        thumbnail: specimen.thumbnail,
        colorMode: index % 3 === 0 ? "RGBA" : "RGB",
        bitsPerChannel: 8, hasAlphaChannel: index % 3 === 0,
      }]),
    ],
  }
})

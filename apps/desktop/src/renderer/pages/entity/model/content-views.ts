import type { EntityComponent, EntityItem } from "@/entities/entity"

export type ContentViewId =
  | "image.inspect"
  | "video.play"
  | "twitter.read"
  | "model.read"
  | "file.info"
  | "civitai.read"
  | "bilibili.read"
export function availableViews(entity: EntityItem | null) {
  const views: {
    id: ContentViewId
    kind: EntityComponent["kind"]
    label: string
  }[] = []
  if (entity?.components.some((component) => component.kind === "image"))
    views.push({ id: "image.inspect", kind: "image", label: "Image" })
  if (entity?.components.some((component) => component.kind === "video"))
    views.push({ id: "video.play", kind: "video", label: "Video" })
  if (entity?.components.some((component) => component.kind === "twitter"))
    views.push({ id: "twitter.read", kind: "twitter", label: "Twitter" })
  if (entity?.components.some((component) => component.kind === "model"))
    views.push({ id: "model.read", kind: "model", label: "Model" })
  if (entity?.components.some((component) => component.kind === "file"))
    views.push({ id: "file.info", kind: "file", label: "File" })
  if (entity?.components.some((component) => component.kind === "civitai"))
    views.push({ id: "civitai.read", kind: "civitai", label: "Civitai" })
  if (entity?.components.some((c) => c.kind === "bilibili"))
    views.push({ id: "bilibili.read", kind: "bilibili", label: "Bilibili" })
  return views
}
export function resolveView(entity: EntityItem | null, preferred: string | null) {
  const available = availableViews(entity)
  return available.find((view) => view.id === preferred)?.id ?? available[0]?.id ?? null
}

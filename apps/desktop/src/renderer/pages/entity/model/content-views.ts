import type { EntityItem } from "@/entities/entity"

export type ContentViewId = "image.inspect" | "file.info"
export function availableViews(entity: EntityItem | null) {
  const views: { id: ContentViewId; kind: "image" | "file"; label: string }[] = []
  if (entity?.components.some((component) => component.kind === "image"))
    views.push({ id: "image.inspect", kind: "image", label: "Image" })
  if (entity?.components.some((component) => component.kind === "file"))
    views.push({ id: "file.info", kind: "file", label: "File" })
  return views
}
export function resolveView(entity: EntityItem | null, preferred: string | null) {
  const available = availableViews(entity)
  return available.find((view) => view.id === preferred)?.id ?? available[0]?.id ?? null
}

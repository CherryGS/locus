import { BoxIcon, FileIcon } from "lucide-react"
import type { EntityItem } from "../model/entity-item"

export function EntityThumbnail({ entity }: { entity: EntityItem }) {
  if (entity.thumbnail) {
    return <img src={entity.thumbnail} alt="" draggable={false} decoding="async" className="size-full object-contain" />
  }

  const Icon = entity.components.some((component) => component.kind === "file") ? FileIcon : BoxIcon
  return (
    <div className="flex size-full items-center justify-center text-muted-foreground" aria-hidden="true">
      <Icon className="size-9" strokeWidth={1.25} />
    </div>
  )
}

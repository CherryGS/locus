import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import type { EntityItem } from "../model/entity-item"
import { EntityThumbnail } from "./entity-thumbnail"

export function EntityCard({ entity }: { entity: EntityItem }) {
  const image = entity.components.find((component) => component.kind === "image")
  const description = image
    ? `${image.width} × ${image.height}`
    : entity.components.some((component) => component.kind === "file") ? "File" : "Entity"

  return (
    <Card size="sm" className="h-full gap-0 py-0">
      <div className="min-h-0 flex-1 bg-muted/20">
        <EntityThumbnail entity={entity} />
      </div>
      <CardHeader className="h-16 shrink-0 py-2">
        <CardTitle className="truncate">{entity.name}</CardTitle>
        <CardDescription className="truncate">{description}</CardDescription>
      </CardHeader>
    </Card>
  )
}

import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import type { EntityItem } from "../model/entity-item"
import { entityCardDisplay } from "../model/entity-card-display"
import { EntityThumbnail } from "./entity-thumbnail"

export function EntityCard({ entity, titleId }: { entity: EntityItem; titleId: string }) {
  const display = entityCardDisplay(entity)

  return (
    <Card size="sm" className="h-full gap-0 py-0">
      <div className="min-h-0 flex-1 bg-muted/20">
        <EntityThumbnail
          src={display.preview?.src}
          hasFile={entity.components.some((component) => component.kind === "file")}
          hasVideo={entity.components.some((component) => component.kind === "video")}
          hasTwitter={entity.components.some((component) => component.kind === "twitter")}
        />
      </div>
      <CardHeader className="h-16 shrink-0 py-2">
        <CardTitle id={titleId} className="truncate">{display.title ?? entity.name}</CardTitle>
        <CardDescription className="truncate">{display.summary ?? "Entity"}</CardDescription>
      </CardHeader>
    </Card>
  )
}

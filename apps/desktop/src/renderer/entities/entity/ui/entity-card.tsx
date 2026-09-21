import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import type { EntityItem } from "../model/entity-item"
import { entityCardDisplay } from "../model/entity-card-display"
import { EntityThumbnail } from "./entity-thumbnail"
import { entityLabel } from "../model/entity-item"
import { CircleAlertIcon } from "lucide-react"
import { Skeleton } from "@/shared/ui/skeleton"

export function EntityCard({ entity, titleId }: { entity: EntityItem; titleId: string }) {
  const display = entityCardDisplay(entity)

  return (
    <Card size="sm" className="h-full gap-0 py-0">
      <div className="relative min-h-0 flex-1 bg-muted/20">
        <EntityThumbnail
          src={display.preview?.src}
          hasFile={entity.components.some((component) => component.kind === "file")}
          hasVideo={entity.components.some((component) => component.kind === "video")}
          hasTwitter={entity.components.some((component) => component.kind === "twitter")}
        />
        {!!entity.problems?.length && (
          <CircleAlertIcon
            role="img"
            aria-label="Entity has problems"
            className="absolute top-2 right-2 size-4 text-destructive"
          />
        )}
      </div>
      <CardHeader className="h-16 shrink-0 py-2">
        <CardTitle id={titleId} className="truncate">
          {display.title ?? entityLabel(entity)}
        </CardTitle>
        <CardDescription className="truncate">
          {display.summary ?? (entity.loading ? <Skeleton className="h-3 w-20" /> : "Entity")}
        </CardDescription>
      </CardHeader>
    </Card>
  )
}

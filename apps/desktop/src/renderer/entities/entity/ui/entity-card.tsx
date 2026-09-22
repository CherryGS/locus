import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card"
import type { EntityItem } from "../model/entity-item"
import { entityCardDisplay } from "../model/entity-card-display"
import { EntityThumbnail } from "./entity-thumbnail"
import { entityLabel } from "../model/entity-item"
import { CircleAlertIcon } from "lucide-react"
import { Skeleton } from "@/shared/ui/skeleton"
import { Badge } from "@/shared/ui/badge"
import { Spinner } from "@/shared/ui/spinner"

export function EntityCard({ entity, titleId }: { entity: EntityItem; titleId: string }) {
  const display = entityCardDisplay(entity)
  const title = display.title ?? entityLabel(entity)

  return (
    <Card size="sm" className="h-full gap-0 py-0">
      <CardContent className="relative min-h-0 flex-1 bg-muted/20 px-0">
        <EntityThumbnail
          src={display.preview?.src}
          hasFile={entity.components.some((component) => component.kind === "file")}
          hasVideo={entity.components.some((component) => component.kind === "video")}
          hasTwitter={entity.components.some((component) => component.kind === "twitter")}
          fallbackLabel={entity.loading ? undefined : "No preview"}
        />
        {entity.loading && (
          <Badge variant="secondary" className="absolute top-2 left-2 size-6 p-0" aria-hidden="true">
            <Spinner />
          </Badge>
        )}
        {!!entity.problems?.length && (
          <div className="absolute top-2 right-2 rounded-full bg-background/90">
            <Badge variant="destructive" role="img" aria-label="Entity has problems" className="size-6 p-0">
              <CircleAlertIcon aria-hidden="true" />
            </Badge>
          </div>
        )}
      </CardContent>
      <CardHeader className="h-14 shrink-0 gap-0.5 py-1.5">
        <CardTitle id={titleId} className="truncate" title={title}>
          {title}
        </CardTitle>
        <CardDescription className="h-5 truncate">
          {display.summary ?? (entity.loading ? <Skeleton className="mt-1 h-3 w-20" /> : "—")}
        </CardDescription>
      </CardHeader>
    </Card>
  )
}

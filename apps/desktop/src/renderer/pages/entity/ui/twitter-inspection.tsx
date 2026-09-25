import { TwitterPost, type EntityComponent, type EntityItem, type EntityReader } from "@/entities/entity"
import type { BackendApi } from "@/shared/api"
import type { PlaybackCoordinator } from "@/features/video-playback"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { LiveImage } from "./live-image"
import { LiveVideo } from "./live-video"

export function TwitterInspection({
  entity,
  component,
  live,
}: {
  entity: EntityItem
  component: Extract<EntityComponent, { kind: "twitter" }>
  live?: { api: BackendApi; reader: EntityReader; playback: PlaybackCoordinator }
}) {
  const input = component.applicability
  const basis =
    input?.status === "input" &&
    input.host === entity.id &&
    input.comparison.status === "matching" &&
    input.comparison.file_id === component.record?.basis &&
    !component.previous
      ? input.comparison.file_id
      : undefined
  const video = entity.components.find((item) => item.kind === "video" && basis && item.inputFileId === basis)
  const image = entity.components.find((item) => item.kind === "image" && basis && item.inputFileId === basis)
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="p-5 sm:p-6">
        <TwitterPost
          component={component}
          onReread={live ? () => void live.reader.reread(entity.id) : undefined}
          media={
            live && video?.kind === "video" ? (
              <div className="flex aspect-video max-h-[60vh] min-h-56 flex-col overflow-hidden rounded-xl border">
                <LiveVideo
                  {...live}
                  entityId={entity.id}
                  video={video}
                  name={component.altText || "Twitter video"}
                />
              </div>
            ) : live && image?.kind === "image" ? (
              <LiveImage
                {...live}
                entityId={entity.id}
                componentId={image.id}
                fileId={image.inputFileId}
                name={component.altText || "Twitter image"}
                loading={image.readStatus === "loading"}
                embedded
              />
            ) : undefined
          }
        />
      </div>
    </ScrollArea>
  )
}

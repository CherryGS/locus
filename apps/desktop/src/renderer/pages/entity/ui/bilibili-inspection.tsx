import { BilibiliReading, entityLabel, type EntityComponent, type EntityItem, type EntityReader } from "@/entities/entity"
import type { BackendApi } from "@/shared/api"
import type { PlaybackCoordinator } from "@/features/video-playback"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { LiveVideo } from "./live-video"

export function BilibiliInspection({ entity, component, live }: {
  entity: EntityItem
  component: Extract<EntityComponent, { kind: "bilibili" }>
  live?: { api: BackendApi; reader: EntityReader; playback: PlaybackCoordinator }
}) {
  const video = entity.components.find((candidate) => candidate.kind === "video")
  const input = component.view?.applicability
  // A readable capture is not evidence that the Entity's current Video is its
  // captured file. Compose playback only when both owners identify that File.
  const matching = input?.status === "input" && input.host === entity.id &&
    input.comparison.status === "matching" &&
    input.comparison.file_id === component.record?.basis &&
    video?.inputFileId === input.comparison.file_id
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="p-5 sm:p-6">
        <BilibiliReading
          key={`${entity.id}:${component.id}`}
          component={component}
          playbackPending={entity.membershipsStatus === "loading" || component.readStatus === "loading" || video?.readStatus === "loading"}
          player={live && video && matching ? (
            <div className="flex aspect-video max-h-[65vh] min-h-64 flex-col overflow-hidden rounded-xl border">
              <LiveVideo
                {...live}
                entityId={entity.id}
                video={video}
                poster={component.cover?.forVideo ? component.cover.thumbnail : undefined}
                name={entityLabel(entity)}
              />
            </div>
          ) : undefined}
          onRetryCover={live ? () => live.reader.retryBilibiliCover(entity.id) : undefined}
          onReread={live ? () => void live.reader.reread(entity.id) : undefined}
        />
      </div>
    </ScrollArea>
  )
}

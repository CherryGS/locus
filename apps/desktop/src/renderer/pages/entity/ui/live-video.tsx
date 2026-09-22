import { useEffect } from "react"
import type { EntityComponent, EntityReader } from "@/entities/entity"
import type { BackendApi } from "@/shared/api"
import type { PlaybackCoordinator } from "@/features/video-playback"
import { VideoInspection } from "./video-inspection"

export function LiveVideo({
  api,
  reader,
  playback,
  entityId,
  video,
  name,
}: {
  api: BackendApi
  reader: EntityReader
  playback: PlaybackCoordinator
  entityId: string
  video: Extract<EntityComponent, { kind: "video" }>
  name: string
}) {
  const attempt = reader.playbackRevision(entityId)
  const basis = `${video.id}:${video.inputFileId}`
  useEffect(() => {
    if (!video.inputFileId && video.readStatus === "ready" && video.applicability?.status !== "error")
      playback.forget(entityId)
  }, [playback, entityId, video.inputFileId, video.readStatus, video.applicability])
  return (
    <>
      {(video.inputPrevious || video.previous) && (
        <p role="status" className="px-4 py-2 text-xs text-muted-foreground">
          Current input could not be rechecked. The previous observed video remains available; see Overview.
        </p>
      )}
      <VideoInspection
        key={`${entityId}:${basis}:${attempt}`}
        src={video.inputFileId ? api.originalUrl(video.inputFileId) : undefined}
        poster={video.thumbnail}
        name={name}
        componentId={video.id}
        entityId={entityId}
        fileId={video.inputFileId}
        playback={playback}
        attempt={attempt}
        pending={reader.playbackPending(entityId) || (!video.inputFileId && video.readStatus === "loading")}
        onResult={(message) => reader.resourceResult(entityId, basis, attempt, message)}
        onRetry={() => reader.retryResource(entityId, basis)}
      />
    </>
  )
}

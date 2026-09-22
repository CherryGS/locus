import { useLayoutEffect, useRef } from "react"
import {
  EntityCard,
  EntityComponentDetails,
  TwitterPost,
  entityLabel,
  type EntityItem,
  type EntitySource,
  type EntityReader,
} from "@/entities/entity"
import type { PlaybackCoordinator } from "@/features/video-playback"
import { LiveVideo } from "./live-video"
import type { BackendApi } from "@/shared/api"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/ui/empty"
import { Button } from "@/shared/ui/button"
import { ScrollArea } from "@/shared/ui/scroll-area"
import type { ContentViewId } from "../model/content-views"
import type { RelatedCollection } from "../model/navigation"
import { ImageInspection } from "./image-inspection"
import { VideoInspection } from "./video-inspection"
import { LiveImage } from "./live-image"

export function EntityContent({
  entity,
  viewId,
  source,
  live,
  collections,
  onRelated,
}: {
  entity: EntityItem
  viewId: ContentViewId | null
  source: EntitySource
  live?: { api: BackendApi; reader: EntityReader; playback: PlaybackCoordinator }
  collections: readonly RelatedCollection[]
  onRelated: (collection: RelatedCollection, entity: EntityItem) => void
}) {
  const focus = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (document.activeElement === document.body) focus.current?.focus({ preventScroll: true })
  }, [])
  const image = entity.components.find((component) => component.kind === "image")
  const video = entity.components.find((component) => component.kind === "video")
  const file = entity.components.find((component) => component.kind === "file")
  const twitter = entity.components.find((component) => component.kind === "twitter")
  return (
    <section
      ref={focus}
      tabIndex={-1}
      data-slot="entity-inspection"
      data-entity-id={entity.id}
      data-view-id={viewId ?? "none"}
      aria-label={`Inspect ${entityLabel(entity)}`}
      className="flex h-full min-h-0 flex-col outline-none"
    >
      {viewId === "image.inspect" ? (
        live && image ? (
          <LiveImage
            api={live.api}
            reader={live.reader}
            entityId={entity.id}
            componentId={image.id}
            fileId={image.inputFileId}
            name={entityLabel(entity)}
            loading={image.readStatus === "loading"}
          />
        ) : (
          <ImageInspection
            key={`${entity.id}:${image?.id}:${image?.thumbnail}`}
            src={image?.thumbnail}
            name={entityLabel(entity)}
          />
        )
      ) : viewId === "video.play" ? (
        live && video ? <LiveVideo {...live} entityId={entity.id} video={video} name={entityLabel(entity)} /> : <VideoInspection
          key={`${entity.id}:${video?.id}:${video?.src}`}
          src={video?.src}
          poster={video?.thumbnail}
          name={entityLabel(entity)}
        />
      ) : viewId === "twitter.read" && twitter ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-6">
            <TwitterPost component={twitter} />
          </div>
        </ScrollArea>
      ) : viewId === "file.info" && file ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
            <h2 className="text-lg font-medium break-words">{file.originalName ?? `File ${file.id}`}</h2>
            <EntityComponentDetails component={file} />
            {collections
              .filter((collection) => collection.ownerId === entity.id && collection.viewId === viewId)
              .map((collection) => (
                <section key={collection.id} aria-label={collection.name} className="flex flex-col gap-3">
                  <h3 className="text-sm font-medium">{collection.name}</h3>
                  <p className="text-xs text-muted-foreground">Double-click an Entity or press Enter to inspect it.</p>
                  <div className="flex flex-wrap gap-3">
                    {collection.entityIds
                      .map((id) => source.get(id))
                      .map((item) => (
                        <Button
                          key={item.id}
                          variant="ghost"
                          className="h-48 w-44 p-0"
                          aria-label={`Open ${entityLabel(item)} in ${collection.name}`}
                          onDoubleClick={() => onRelated(collection, item)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault()
                              onRelated(collection, item)
                            }
                          }}
                        >
                          <EntityCard entity={item} titleId={`gallery-${collection.id}-${item.id}`} />
                        </Button>
                      ))}
                  </div>
                </section>
              ))}
          </div>
        </ScrollArea>
      ) : (
        <Empty className="h-full">
          <EmptyHeader>
            <EmptyTitle>No preview available</EmptyTitle>
            <EmptyDescription>This Entity has no available content view.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  )
}

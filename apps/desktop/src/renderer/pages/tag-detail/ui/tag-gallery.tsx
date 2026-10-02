import { useCallback, useEffect, useMemo, type ReactNode } from "react"
import { ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react"
import {
  entityCardDisplay,
  entityLabel,
  EntityThumbnail,
  type EntitySource,
  type EntityItem,
} from "@/entities/entity"
import { Button } from "@/shared/ui/button"
import { Spinner } from "@/shared/ui/spinner"
import { Separator } from "@/shared/ui/separator"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import { cn } from "@/shared/lib/utils"

function Thumbnail({
  entity,
  originalUrl,
  compact = false,
}: {
  entity: EntityItem
  originalUrl: (id: string) => string
  compact?: boolean
}) {
  const image = entity.components.find(
    (component) =>
      component.kind === "image" &&
      component.applicability?.status === "matching" &&
      entity.components.some((file) => file.kind === "file" && file.id === component.inputFileId),
  )
  const original =
    image?.kind === "image" && image.inputFileId ? originalUrl(image.inputFileId) : undefined
  return (
    <EntityThumbnail
      src={entityCardDisplay(entity).preview?.src ?? original}
      hasFile={entity.components.some((c) => c.kind === "file")}
      hasVideo={entity.components.some((c) => c.kind === "video")}
      hasTwitter={entity.components.some((c) => c.kind === "twitter")}
      fallbackLabel={compact || entity.loading ? undefined : "No preview"}
    />
  )
}

export function TagGallery({
  source,
  selectedId,
  onSelect,
  controls,
  pending,
  established,
  error,
  retained,
  refresh,
  reread,
  originalUrl,
}: {
  source: EntitySource
  selectedId?: string
  onSelect: (id: string) => void
  controls: ReactNode
  pending: boolean
  established: boolean
  error?: string
  retained?: string
  refresh: () => void
  reread: (id: string) => void
  originalUrl: (id: string) => string
}) {
  const sequence = source.sequence
  const selectedIndex = selectedId ? sequence.indexOf(selectedId) : -1
  const index = selectedIndex < 0 ? 0 : selectedIndex
  const id = sequence.at(index)
  const entity = id ? source.get(id) : undefined
  const display = entity && entityCardDisplay(entity)
  const title = entity ? (display?.title ?? entityLabel(entity)) : undefined
  const neighbors = useMemo(() => {
    const start = Math.max(0, Math.min(index - 2, sequence.length - 5))
    return Array.from({ length: Math.min(5, sequence.length) }, (_, offset) =>
      sequence.at(start + offset)!,
    )
  }, [sequence, index])
  useEffect(() => {
    source.demand(neighbors)
  }, [source.demand, neighbors])
  const move = useCallback(
    (direction: -1 | 1) => {
      const next = sequence.at(index + direction)
      if (next) onSelect(next)
    },
    [sequence, index, onSelect],
  )
  useEffect(() => {
    const arrows = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        !["ArrowLeft", "ArrowRight"].includes(event.key) ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="separator"], [role="slider"], [data-slot="toggle-group"]',
          )) ||
        document.querySelector(
          '[data-slot="dialog-content"][data-open], [role="menu"], [data-slot="select-content"], [data-slot="popover-content"]',
        )
      )
        return
      event.preventDefault()
      move(event.key === "ArrowLeft" ? -1 : 1)
    }
    window.addEventListener("keydown", arrows)
    return () => window.removeEventListener("keydown", arrows)
  }, [move])
  return (
    <section
      aria-label="Associated content"
      aria-roledescription="carousel"
      className="flex h-full min-h-0 min-w-0 flex-col"
    >
      <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 px-4 py-1.5">
        <p className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground sm:block">Gallery</p>
        {controls}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh tag content"
          disabled={pending}
          onClick={refresh}
        >
          {pending ? <Spinner /> : <RefreshCwIcon />}
        </Button>
      </header>
      <Separator />
      {(error || retained) && (
        <Alert variant={error ? "destructive" : "default"}>
          <AlertDescription>
            {error} {retained}
          </AlertDescription>
        </Alert>
      )}
      {entity ? (
        <>
          <div className="flex min-h-0 flex-1 items-stretch gap-2 px-3 py-3">
            <Button
              className="self-center"
              size="icon-sm"
              variant="ghost"
              aria-label="Previous entity"
              title="Previous entity (←)"
              disabled={index === 0}
              onClick={() => move(-1)}
            >
              <ChevronLeftIcon />
            </Button>
            <figure
              data-gallery-entity={entity.id}
              aria-label={title}
              className="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
            >
              <div className="relative min-h-0 flex-1 overflow-hidden rounded-md bg-muted/20">
                <Thumbnail entity={entity} originalUrl={originalUrl} />
                {entity.loading && (
                  <span className="absolute top-2 left-2">
                    <Spinner aria-label="Reading entity" />
                  </span>
                )}
              </div>
              <figcaption className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                <span className="min-w-0 flex-1 truncate" title={title}>
                  {title}
                  {display?.summary && ` · ${display.summary}`}
                </span>
                <span role="status" aria-label="Gallery position" className="shrink-0 tabular-nums">
                  {index + 1} / {sequence.length}
                </span>
              </figcaption>
            </figure>
            <Button
              className="self-center"
              size="icon-sm"
              variant="ghost"
              aria-label="Next entity"
              title="Next entity (→)"
              disabled={index >= sequence.length - 1}
              onClick={() => move(1)}
            >
              <ChevronRightIcon />
            </Button>
          </div>
          {!!entity.problems?.length && (
            <Alert>
              <AlertDescription className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  {entity.problems.map((problem) => problem.message).join("; ")}
                </span>
                <Button size="sm" variant="outline" onClick={() => reread(entity.id)}>
                  Retry preview
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {sequence.length > 1 && (
            <div
              role="group"
              aria-label="Gallery thumbnails"
              className="mx-auto flex w-full max-w-md shrink-0 justify-center gap-2 px-4 pb-3"
            >
              {neighbors.map((neighbor) => {
                const item = source.get(neighbor),
                  label = entityCardDisplay(item).title ?? entityLabel(item)
                return (
                  <Button
                    key={neighbor}
                    size="sm"
                    variant="ghost"
                    aria-label={`Show ${label}`}
                    aria-current={neighbor === id ? "true" : undefined}
                    className={cn(
                      "h-12 min-w-0 flex-1 overflow-hidden rounded-md p-0",
                      neighbor === id && "ring-1 ring-ring",
                    )}
                    title={label}
                    onClick={() => onSelect(neighbor)}
                  >
                    <Thumbnail entity={item} originalUrl={originalUrl} compact />
                  </Button>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <Empty className="min-h-0 flex-1">
          <EmptyHeader>
            <EmptyTitle>
              {!established
                ? pending
                  ? "Finding tagged content…"
                  : "Tag content unavailable"
                : "No tagged content"}
            </EmptyTitle>
            <EmptyDescription>
              {pending
                ? established
                  ? "Refreshing; showing the previous empty result."
                  : "Reading associated content."
                : error && !established
                  ? "Refresh to try again."
                  : "This tag has no matching items. Assign tags to content, then refresh."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </section>
  )
}

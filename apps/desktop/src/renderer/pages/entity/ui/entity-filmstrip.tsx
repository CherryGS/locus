import { useLayoutEffect, useRef, useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import type { EntityItem } from "@/entities/entity"
import { Button } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"
import { nearbyEntities } from "../model/navigation"
import { EntityThumbnail } from "@/entities/entity"
import { availableViews, type ContentViewId } from "../model/content-views"

const thumbnailWidth = 96
const gap = 4
const navigationWidth = 2 * 28 + 2 * 4

type EntityFilmstripProps = {
  entities: readonly EntityItem[]
  selectedId: string
  canNavigate: boolean
  viewFor: (entity: EntityItem) => ContentViewId | null
  onSelect: (entity: EntityItem) => void
  onNavigate: (direction: -1 | 1) => void
}

export function EntityFilmstrip({ entities, selectedId, canNavigate, viewFor, onSelect, onNavigate }: EntityFilmstripProps) {
  const strip = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const columns = Math.max(1, Math.floor((width - navigationWidth + gap) / (thumbnailWidth + gap)))
  const capacity = columns % 2 === 0 ? columns - 1 : columns
  const neighbors = nearbyEntities(entities, selectedId, capacity)
  const visibleColumns = 2 * Math.max(0, ...neighbors.map(({ offset }) => Math.abs(offset))) + 1
  const trackWidth = visibleColumns * thumbnailWidth + (visibleColumns - 1) * gap

  useLayoutEffect(() => {
    const element = strip.current
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={strip} data-slot="entity-filmstrip" role="group" aria-label="Nearby entities" className="mx-auto flex h-22 w-full min-w-0 max-w-3xl items-center justify-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label="Previous entity" title="Previous entity (←)" disabled={!canNavigate} onClick={() => onNavigate(-1)}>
        <ChevronLeftIcon data-icon="inline-start" />
      </Button>
      <div data-slot="entity-filmstrip-track" className="relative h-full shrink-0 overflow-hidden" style={{ width: trackWidth }}>
        {neighbors.map(({ entity, offset }) => {
          const thumbnail = entity.components.find((component) => component.kind === "image")?.thumbnail
            ?? entity.components.find((component) => component.kind === "video")?.thumbnail
          const name = entity.components.find((component) => component.kind === "file")?.originalName ?? entity.name
          const selected = entity.id === selectedId
          const viewId = viewFor(entity)
          const componentLabel = availableViews(entity).find((view) => view.id === viewId)?.label ?? "No view"
          const componentLabelId = `filmstrip-component-${entity.id}`
          return (
            <Button
              key={entity.id}
              variant="ghost"
              className="absolute top-2 h-18 -translate-x-1/2 p-0"
              style={{ left: `calc(50% + ${offset * (thumbnailWidth + gap)}px)`, width: thumbnailWidth }}
              aria-label={`View ${name}`}
              aria-describedby={componentLabelId}
              aria-current={selected ? "true" : undefined}
              tabIndex={selected ? 0 : -1}
              title={name}
              onClick={() => onSelect(entity)}
            >
              <span className={cn(
                "relative flex size-full items-center justify-center overflow-hidden rounded-sm border transition-colors motion-reduce:transition-none",
                selected
                  ? "border-muted-foreground/60 bg-accent"
                  : "border-border/50 bg-muted/40 group-hover/button:border-muted-foreground/40 group-hover/button:bg-muted/60"
              )}>
                <span className="flex size-full items-center justify-center [&_svg]:size-6">
                  <EntityThumbnail
                    key={`${entity.id}:${thumbnail}`}
                    src={thumbnail}
                    hasFile={entity.components.some((component) => component.kind === "file")}
                    hasVideo={entity.components.some((component) => component.kind === "video")}
                  />
                </span>
                <span
                  id={componentLabelId}
                  className="pointer-events-none absolute inset-x-0 top-0 bg-black/50 px-1 text-center text-xs leading-4 font-medium text-white"
                >
                  {componentLabel}
                </span>
              </span>
            </Button>
          )
        })}
      </div>
      <Button variant="ghost" size="icon-sm" aria-label="Next entity" title="Next entity (→)" disabled={!canNavigate} onClick={() => onNavigate(1)}>
        <ChevronRightIcon data-icon="inline-start" />
      </Button>
    </div>
  )
}

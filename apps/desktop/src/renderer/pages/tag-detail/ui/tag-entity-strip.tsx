import { useEffect, useLayoutEffect, useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { EntityThumbnail, entityCardDisplay, entityLabel, type EntitySource, type EntityItem, type GridPosition } from "@/entities/entity"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Button } from "@/shared/ui/button"
import { PreviewStrip, PreviewStripFrame } from "@/shared/ui/preview-strip"

type Props = {
  source: EntitySource; selectedId?: string; position?: GridPosition; onPosition: (position: GridPosition) => void
  onSelect: (entity: EntityItem) => void; onOpen: (entity: EntityItem) => void
  pending: boolean; established: boolean; error?: string; retained?: string
}
export function TagEntityStrip(props: Props) {
  return <section aria-label="Associated content" className="flex shrink-0 flex-col px-3">
    {(props.error || props.retained) && <Alert variant={props.error ? "destructive" : "default"}><AlertDescription>{props.error} {props.retained}</AlertDescription></Alert>}
    {props.source.sequence.length ? <AssociatedStrip {...props} /> : <p className="py-4 text-sm text-muted-foreground">
      {!props.established ? props.pending ? "Finding tagged content…" : "Tag content unavailable" : "No tagged content"}
    </p>}
  </section>
}
function AssociatedStrip({ source, selectedId, position, onPosition, onSelect, onOpen }: Props) {
  const viewport = useRef<HTMLDivElement>(null), grid = useRef<HTMLDivElement>(null)
  const restore = useRef(position)
  const selected = selectedId ? source.sequence.indexOf(selectedId) : -1
  const virtual = useVirtualizer({ horizontal: true, count: source.sequence.length, getScrollElement: () => viewport.current, estimateSize: () => 104, overscan: 3 })
  const rows = virtual.getVirtualItems()
  const ids = rows.map(row => source.sequence.at(row.index)!).filter(Boolean)
  const demandKey = ids.join(",")
  useEffect(() => source.demand(ids), [source.demand, demandKey])
  useLayoutEffect(() => {
    if (restore.current) {
      const index = restore.current.anchor ? source.sequence.indexOf(restore.current.anchor) : -1
      if (viewport.current) viewport.current.scrollLeft = index >= 0 ? index * 104 + restore.current.offset : restore.current.logical
      restore.current = undefined
      grid.current?.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => { if (selected >= 0) virtual.scrollToIndex(selected, { align: "auto" }) }, [selected])
  function select(index: number) {
    const id = source.sequence.at(Math.max(0, Math.min(source.sequence.length - 1, index)))
    if (id) onSelect(source.get(id))
    grid.current?.focus({ preventScroll: true })
  }
  return <div className="flex h-24 min-w-0 items-center gap-2">
    <Button size="icon-sm" variant="ghost" aria-label="Previous tagged Entity" disabled={selected <= 0} onClick={() => select(selected - 1)}><ChevronLeftIcon /></Button>
    <div ref={grid} role="grid" aria-label="Entities" aria-rowcount={1} aria-colcount={source.sequence.length} aria-activedescendant={selectedId ? `tag-preview-${selectedId}` : undefined} tabIndex={0}
      className="h-full min-w-0 flex-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return
        if (event.key === "Enter") { event.preventDefault(); if (!event.repeat && selectedId) onOpen(source.get(selectedId)); return }
        const index = event.key === "ArrowLeft" || event.key === "ArrowUp" ? selected - 1 : event.key === "ArrowRight" || event.key === "ArrowDown" ? selected + 1 : event.key === "Home" ? 0 : event.key === "End" ? source.sequence.length - 1 : undefined
        if (index === undefined) return
        event.preventDefault(); event.stopPropagation(); select(index)
      }}>
      <PreviewStrip viewportRef={viewport} onScroll={() => {
        const logical = viewport.current?.scrollLeft ?? 0, index = Math.floor(logical / 104)
        onPosition({ anchor: source.sequence.at(index), offset: logical - index * 104, logical })
      }}>
        <div role="row" data-entity-count={source.sequence.length} className="relative h-full" style={{ width: virtual.getTotalSize() }}>
          {rows.map(row => {
            const id = source.sequence.at(row.index)!, entity = source.get(id)
            const name = entity.components.find(component => component.kind === "file")?.originalName ?? entityLabel(entity)
            return <PreviewStripFrame key={id} className="absolute top-4" style={{ left: row.start, width: 96 }}>
              <Button id={`tag-preview-${id}`} role="gridcell" data-entity-id={id} data-gallery-thumbnail aria-colindex={row.index + 1} aria-selected={id === selectedId} data-pressed={id === selectedId || undefined}
                tabIndex={-1} variant={id === selectedId ? "secondary" : "ghost"} className="h-16 w-24 overflow-hidden rounded-md p-1" aria-label={name} title={name}
                onClick={() => select(row.index)} onDoubleClick={() => onOpen(entity)}>
                <EntityThumbnail src={entityCardDisplay(entity).preview?.src} hasFile={entity.components.some(component => component.kind === "file")} hasVideo={entity.components.some(component => component.kind === "video")} />
              </Button>
            </PreviewStripFrame>
          })}
        </div>
      </PreviewStrip>
    </div>
    <Button size="icon-sm" variant="ghost" aria-label="Next tagged Entity" disabled={selected >= source.sequence.length - 1} onClick={() => select(selected + 1)}><ChevronRightIcon /></Button>
  </div>
}

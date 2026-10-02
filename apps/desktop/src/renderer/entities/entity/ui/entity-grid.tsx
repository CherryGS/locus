import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { EntityCard } from "./entity-card"
import type { EntityItem } from "../model/entity-item"
import type { EntitySource } from "../model/identity-sequence"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { entityGridLayout } from "./entity-grid-layout"
import { restoreGridPosition, type GridPosition } from "../model/grid-position"
import { scrollMapping } from "../model/scroll-mapping"

const {
  gap,
  cardWidth,
  maximumCardWidth,
  cardHeight: rowHeight,
  horizontalInset,
  verticalInset,
} = entityGridLayout
const stride = rowHeight + gap
export function EntityGrid({
  componentFor,
  source,
  position,
  onPosition,
  selectedId,
  onSelect,
  onOpen,
  revealSelectionOnMount,
}: {
  componentFor: (entity: EntityItem) => EntityItem["components"][number]["kind"] | undefined
  source: EntitySource
  position?: GridPosition
  onPosition?: (position: GridPosition) => void
  selectedId?: string
  onSelect: (entity: EntityItem) => void
  onOpen: (entity: EntityItem) => void
  revealSelectionOnMount: boolean
}) {
  const { sequence, get, demand } = source
  const viewport = useRef<HTMLDivElement>(null)
  const restore = useRef(position)
  const reveal = useRef(revealSelectionOnMount && !position)
  const gridId = useId()
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [scroll, setScroll] = useState(0)
  const columns = Math.max(
    1,
    Math.min(sequence.length, Math.floor((size.width - 2 * horizontalInset + gap) / (cardWidth + gap))),
  )
  const rows = Math.ceil(sequence.length / columns)
  const mapping = scrollMapping(rows * stride - gap + 2 * verticalInset, size.height)
  const logical = mapping.logical(scroll)
  const selectedIndex = useMemo(
    () => (selectedId ? sequence.indexOf(selectedId) : -1),
    [sequence, selectedId],
  )
  const selectedRow = selectedIndex < 0 ? -1 : Math.floor(selectedIndex / columns)
  const first = Math.max(0, Math.floor((logical - verticalInset) / stride) - 2)
  const last = Math.min(rows - 1, Math.ceil((logical + size.height - verticalInset) / stride) + 2)
  const visible = Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index)
  if (selectedRow >= 0 && !visible.includes(selectedRow)) visible.push(selectedRow)
  const ids = visible.flatMap((row) =>
    Array.from({ length: Math.min(columns, sequence.length - row * columns) }, (_, column) =>
      sequence.at(row * columns + column)!,
    ),
  )
  const demandKey = ids.join(",")
  useEffect(() => {
    demand(ids)
  }, [demand, demandKey])
  const cellId = (id: string) => `${gridId}-${id}`
  function scrollToRow(row: number, force = false) {
    const element = viewport.current
    if (!element) return
    const top = row * stride + verticalInset
    const current = mapping.logical(element.scrollTop)
    const target =
      force || top < current
        ? top - verticalInset
        : top + rowHeight > current + size.height
          ? top + rowHeight + verticalInset - size.height
          : current
    element.scrollTop = mapping.physical(target)
    setScroll(element.scrollTop)
  }
  const layout = useRef({ columns, logical, selectedRow, selectedIndex, height: size.height })
  layout.current = { columns, logical, selectedRow, selectedIndex, height: size.height }
  const anchor = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => {
      const previous = layout.current
      const newColumns = Math.max(
        1,
        Math.min(
          sequence.length,
          Math.floor((element.clientWidth - 2 * horizontalInset + gap) / (cardWidth + gap)),
        ),
      )
      if (previous.columns !== newColumns) {
        const top = previous.selectedRow * stride + verticalInset
        anchor.current =
          previous.selectedRow >= 0 &&
          top + rowHeight > previous.logical &&
          top < previous.logical + previous.height
            ? previous.selectedIndex
            : Math.max(0, Math.floor((previous.logical - verticalInset + gap) / stride)) * previous.columns
      }
      setSize({ width: element.clientWidth, height: element.clientHeight })
    }
    const observer = new ResizeObserver(measure)
    measure()
    observer.observe(element)
    return () => observer.disconnect()
  }, [sequence])
  useLayoutEffect(() => {
    if (restore.current && size.width && size.height && sequence.length) {
      const target = restoreGridPosition(restore.current, sequence, columns, stride)
      restore.current = undefined
      anchor.current = undefined
      if (viewport.current) {
        viewport.current.scrollTop = mapping.physical(target)
        setScroll(viewport.current.scrollTop)
        // Returning from direct inspection restores the viewport without moving
        // selection, but the grid must still regain its keyboard interaction.
        if (revealSelectionOnMount) viewport.current.focus({ preventScroll: true })
      }
    }
    if (anchor.current !== undefined && size.width) {
      scrollToRow(Math.floor(anchor.current / columns), true)
      anchor.current = undefined
    }
    if (reveal.current && size.width) {
      reveal.current = false
      if (selectedRow >= 0) scrollToRow(selectedRow)
      viewport.current?.focus({ preventScroll: true })
    }
  }, [columns, size.width, size.height, sequence])
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.deltaY === 0) return
      event.preventDefault()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1)
      element.scrollTop = mapping.physical(mapping.logical(element.scrollTop) + delta)
    }
    element.addEventListener("wheel", wheel, { passive: false })
    return () => element.removeEventListener("wheel", wheel)
  }, [rows, size.height])
  function select(index: number) {
    const id = sequence.at(index)
    if (id) {
      viewport.current?.focus({ preventScroll: true })
      onSelect(get(id))
    }
  }
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.shiftKey) return
    if (event.key === "Enter") {
      if (selectedId && selectedIndex >= 0) {
        event.preventDefault()
        onOpen(get(selectedId))
      }
      return
    }
    let index = Math.max(0, selectedIndex)
    const rowStart = Math.floor(index / columns) * columns
    switch (event.key) {
      case "ArrowRight":
        index += selectedIndex < 0 ? 0 : 1
        break
      case "ArrowLeft":
        index -= selectedIndex < 0 ? 0 : 1
        break
      case "ArrowDown":
        index += selectedIndex < 0 ? 0 : columns
        break
      case "ArrowUp":
        index -= selectedIndex < 0 ? 0 : columns
        break
      case "Home":
        index = event.ctrlKey || event.metaKey ? 0 : rowStart
        break
      case "End":
        index = event.ctrlKey || event.metaKey ? sequence.length - 1 : rowStart + columns - 1
        break
      default:
        return
    }
    event.preventDefault()
    index = Math.max(0, Math.min(sequence.length - 1, index))
    select(index)
    scrollToRow(Math.floor(index / columns))
  }
  // Fill the row at ordinary widths while keeping a short result set from
  // stretching a single card across the workspace. Row height stays fixed for
  // virtual scrolling; column changes retain the existing identity anchor.
  const fittedCardWidth = Math.min(
    maximumCardWidth,
    Math.max(cardWidth, (size.width - 2 * horizontalInset - (columns - 1) * gap) / columns),
  )
  const rowWidth = columns * fittedCardWidth + (columns - 1) * gap
  const rowInset = Math.max(horizontalInset, (size.width - rowWidth) / 2)
  return (
    <ScrollArea
      className="h-full min-h-0"
      scrollbarProps={{ className: "data-vertical:border-l-border" }}
      viewportProps={{
        ref: viewport,
        role: "grid",
        "aria-label": "Entities",
        "aria-rowcount": rows,
        "aria-colcount": columns,
        "aria-multiselectable": false,
        "aria-activedescendant": selectedIndex >= 0 && selectedId ? cellId(selectedId) : undefined,
        tabIndex: 0,
        className: "[overflow-anchor:none]",
        onKeyDown: navigate,
        onScroll: (event) => {
          const physical = event.currentTarget.scrollTop
          setScroll(physical)
          if (restore.current || !size.width || !sequence.length) return
          const logical = mapping.logical(physical)
          const row = Math.max(0, Math.floor(logical / stride))
          onPosition?.({ anchor: sequence.at(row * columns), offset: logical - row * stride, logical })
        },
      }}
    >
      <div
        className="relative w-full"
        style={{ height: mapping.height }}
        data-entity-count={sequence.length}
        data-id-bytes={sequence.byteLength}
      >
        {visible.map((row) => (
          <div
            key={row}
            role="row"
            aria-rowindex={row + 1}
            className="absolute top-0 grid grid-rows-1"
            style={{
              left: rowInset,
              width: rowWidth,
              height: rowHeight,
              gap,
              gridTemplateColumns: `repeat(${columns}, ${fittedCardWidth}px)`,
              transform: `translateY(${row < first || row > last ? -10000 : scroll + verticalInset + row * stride - logical}px)`,
            }}
          >
            {Array.from({ length: Math.min(columns, sequence.length - row * columns) }, (_, column) => {
              const id = sequence.at(row * columns + column)!
              const entity = get(id)
              // Paint interaction outlines above positioned preview content.
              return (
                <div
                  key={id}
                  id={cellId(id)}
                  role="gridcell"
                  data-entity-id={entity.id}
                  aria-colindex={column + 1}
                  aria-labelledby={`${cellId(id)}-title`}
                  aria-selected={id === selectedId}
                  aria-busy={!!entity.loading}
                  className="relative isolate min-h-0 min-w-0 cursor-default rounded-xl select-none after:pointer-events-none after:absolute after:inset-0 after:z-10 after:rounded-[inherit] after:outline-offset-[-2px] hover:after:outline-1 hover:after:outline-ring/60 aria-selected:after:outline-2 aria-selected:after:outline-primary/60"
                  onClick={() => select(row * columns + column)}
                  onDoubleClick={() => onOpen(entity)}
                >
                  <EntityCard
                    componentKind={componentFor(entity)}
                    entity={entity}
                    titleId={`${cellId(id)}-title`}
                  />
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

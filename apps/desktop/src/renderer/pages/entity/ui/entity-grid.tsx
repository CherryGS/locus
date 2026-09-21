import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react"
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual"
import { EntityCard, type EntityItem } from "@/entities/entity"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { entityGridLayout } from "./entity-grid-layout"

const { gap, cardWidth, cardHeight: rowHeight, horizontalInset, verticalInset } = entityGridLayout

function columnCount(width: number, count: number) {
  return Math.min(count, Math.max(1, Math.floor((width - 2 * horizontalInset + gap) / (cardWidth + gap))))
}

type EntityGridProps = {
  entities: readonly EntityItem[]
  selectedId: string | undefined
  onSelect: (entity: EntityItem) => void
  onOpen: (entity: EntityItem) => void
  revealSelectionOnMount: boolean
}

export function EntityGrid({ entities, selectedId, onSelect, onOpen, revealSelectionOnMount }: EntityGridProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const revealSelection = useRef(revealSelectionOnMount)
  const resizeAnchor = useRef<{ index: number; align: "auto" | "start" } | undefined>(undefined)
  const gridId = useId()
  const [width, setWidth] = useState(0)
  const columns = columnCount(width, entities.length)
  const rowWidth = columns * cardWidth + (columns - 1) * gap
  const selectedIndex = entities.findIndex((entity) => entity.id === selectedId)
  const selectedRow = selectedIndex < 0 ? -1 : Math.floor(selectedIndex / columns)
  const cellId = (id: string) => `${gridId}-${id}`

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    function measureWidth() {
      if (!element || element.clientWidth === width) return
      const stride = rowHeight + gap
      const selectedTop = verticalInset + selectedRow * stride
      const selectionVisible = selectedRow >= 0
        && selectedTop + rowHeight > element.scrollTop
        && selectedTop < element.scrollTop + element.clientHeight
      // Reflow keeps a visible selection in view. When browsing elsewhere,
      // preserve the first visible entity instead of jumping back to selection.
      if (columnCount(element.clientWidth, entities.length) !== columns) resizeAnchor.current = {
        // Include the row gap so a subpixel-rounded scroll position just before
        // a row start does not walk backward one row on every resize event.
        index: selectionVisible ? selectedIndex : Math.min(entities.length - 1, Math.max(0, Math.floor((element.scrollTop - verticalInset + gap) / stride)) * columns),
        align: selectionVisible ? "auto" : "start",
      }
      setWidth(element.clientWidth)
    }
    const observer = new ResizeObserver(measureWidth)
    measureWidth()
    observer.observe(element)
    return () => observer.disconnect()
  }, [columns, entities.length, selectedIndex, selectedRow, width])

  const virtualizer = useVirtualizer({
    count: Math.ceil(entities.length / columns),
    getScrollElement: () => viewport.current,
    estimateSize: () => rowHeight,
    getItemKey: useCallback((row: number) => entities[row * columns].id, [columns, entities]),
    gap,
    paddingStart: verticalInset,
    paddingEnd: verticalInset,
    scrollPaddingStart: verticalInset,
    scrollPaddingEnd: verticalInset,
    overscan: 2,
    rangeExtractor: useCallback((range: Range) => {
      const rows = defaultRangeExtractor(range)
      // The grid keeps DOM focus while scrolling. Keep its active descendant
      // mounted even when that selected row moves outside the visible range.
      if (selectedRow >= 0 && !rows.includes(selectedRow)) rows.push(selectedRow)
      return rows.sort((a, b) => a - b)
    }, [selectedRow]),
  })

  useLayoutEffect(() => {
    const anchor = resizeAnchor.current
    if (width > 0 && anchor) {
      resizeAnchor.current = undefined
      virtualizer.scrollToIndex(Math.floor(anchor.index / columns), { align: anchor.align })
    }
  }, [columns, virtualizer, width])

  useLayoutEffect(() => {
    if (!revealSelection.current || width === 0 || selectedRow < 0) return
    revealSelection.current = false
    // The viewer unmounts the grid. Locate the shared selection only after the
    // new viewport width establishes its current column count, then return focus.
    virtualizer.scrollToIndex(selectedRow, { align: "auto" })
    viewport.current?.focus({ preventScroll: true })
  }, [selectedRow, virtualizer, width])

  function select(index: number) {
    viewport.current?.focus({ preventScroll: true })
    onSelect(entities[index])
  }

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.shiftKey) return
    if (event.key === "Enter") {
      if (selectedIndex >= 0) {
        event.preventDefault()
        onOpen(entities[selectedIndex])
      }
      return
    }
    let index = Math.max(0, selectedIndex)
    const rowStart = Math.floor(index / columns) * columns
    switch (event.key) {
      case "ArrowRight": index += selectedIndex < 0 ? 0 : 1; break
      case "ArrowLeft": index -= selectedIndex < 0 ? 0 : 1; break
      case "ArrowDown": index += selectedIndex < 0 ? 0 : columns; break
      case "ArrowUp": index -= selectedIndex < 0 ? 0 : columns; break
      case "Home": index = event.ctrlKey || event.metaKey ? 0 : rowStart; break
      case "End": index = event.ctrlKey || event.metaKey ? entities.length - 1 : rowStart + columns - 1; break
      default: return
    }
    event.preventDefault()
    index = Math.max(0, Math.min(entities.length - 1, index))
    select(index)
    virtualizer.scrollToIndex(Math.floor(index / columns), { align: "auto" })
  }

  return (
    <ScrollArea
      className="h-full min-h-0"
      scrollbarProps={{ className: "data-vertical:border-l-border" }}
      viewportProps={{
        ref: viewport,
        role: "grid",
        "aria-label": "Entities",
        "aria-rowcount": Math.ceil(entities.length / columns),
        "aria-colcount": columns,
        "aria-multiselectable": false,
        "aria-activedescendant": selectedIndex >= 0 ? cellId(entities[selectedIndex].id) : undefined,
        tabIndex: 0,
        className: "[overflow-anchor:none]",
        onFocus: () => { if (selectedIndex < 0) onSelect(entities[0]) },
        onKeyDown: navigate,
      }}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            role="row"
            aria-rowindex={row.index + 1}
            className="absolute top-0 grid grid-rows-1"
            style={{ left: Math.max(horizontalInset, (width - rowWidth) / 2), width: rowWidth, height: row.size, gap, gridTemplateColumns: `repeat(${columns}, ${cardWidth}px)`, transform: `translateY(${row.start}px)` }}
          >
            {entities.slice(row.index * columns, (row.index + 1) * columns).map((entity, column) => (
              <div
                key={entity.id}
                id={cellId(entity.id)}
                role="gridcell"
                aria-colindex={column + 1}
                aria-labelledby={`${cellId(entity.id)}-title`}
                aria-selected={entity.id === selectedId}
                className="min-h-0 min-w-0 cursor-default rounded-xl outline-offset-[-2px] select-none aria-selected:outline-2 aria-selected:outline-ring"
                onClick={() => select(row.index * columns + column)}
                onDoubleClick={() => onOpen(entity)}
              >
                <EntityCard entity={entity} titleId={`${cellId(entity.id)}-title`} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}

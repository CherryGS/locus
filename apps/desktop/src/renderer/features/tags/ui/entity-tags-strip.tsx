import { useLayoutEffect, useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import { CircleAlertIcon, PlusIcon, TagsIcon } from "lucide-react"
import type { EntityItem } from "@/entities/entity"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Spinner } from "@/shared/ui/spinner"
import type { TagCoordinator } from "../model/tag-coordinator"
import { AddTagDialog } from "./add-tag-dialog"
import { useEntityTags } from "./use-entity-tags"
import { latestAssignmentAttempts } from "../model/entity-tag-observation"

export function EntityTagsStrip({ entity, coordinator: c, onShowAll }: {
  entity: EntityItem
  coordinator: TagCoordinator
  onShowAll: () => void
}) {
  const { tags, waiting, failed, attempts } = useEntityTags(entity, c)
  const attention = latestAssignmentAttempts(attempts).some((attempt) => attempt.state === "failed" || attempt.state === "unconfirmed")
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const measurements = useRef<HTMLDivElement>(null)
  const [capacity, setCapacity] = useState(0)
  const candidates = tags.slice(0, 4)
  const names = JSON.stringify(candidates.map((tag) => tag.name))
  useLayoutEffect(() => {
    const element = viewport.current
    const row = measurements.current
    if (!element || !row) return
    // Measure capped chip widths, including the flex gap, instead of estimating
    // from name length. The actual row reserves room for +N and action buttons.
    const measure = () => {
      const gap = parseFloat(getComputedStyle(element).columnGap) || 0
      let used = 0
      let count = 0
      for (const chip of row.children) {
        used += chip.getBoundingClientRect().width + (count ? gap : 0)
        if (used > element.clientWidth) break
        count++
      }
      setCapacity(count)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    observer.observe(row)
    return () => observer.disconnect()
  }, [names])
  const visible = failed ? [] : candidates.slice(0, capacity)
  const remaining = tags.length - visible.length
  return (
    <section aria-label="Personal tag summary" data-entity-id={entity.id}
      className="@container/tag-strip relative flex h-9 min-w-0 shrink-0 items-center gap-1.5 px-2">
      <div aria-hidden="true" className="pointer-events-none invisible absolute size-0 overflow-hidden">
        <div ref={measurements} className="flex w-max gap-1.5">
          {candidates.map((tag) => <Badge key={tag.id} variant="secondary" className="max-w-36 min-w-0">
            <span className="truncate">{tag.name}</span>
          </Badge>)}
        </div>
      </div>
      <Button size="icon-xs" variant="ghost" className="@max-[14rem]/tag-strip:hidden"
        aria-label="Show personal tags" title="Show personal tags" onClick={onShowAll}>
        <TagsIcon />
      </Button>
      {waiting && <Spinner aria-label="Reading personal tags" className="shrink-0" />}
      <div ref={viewport} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {failed && <Button size="xs" variant="ghost" className="min-w-0 shrink truncate"
          onClick={onShowAll}>Tags unavailable{tags.length ? " · previous assignments" : ""}</Button>}
        {visible.map((tag) => <Badge key={tag.id} variant="secondary" className="max-w-36 min-w-0"
          render={<Link to="/tag/$tagId" params={{ tagId: tag.id }} search={{}} title={tag.name} />}>
          <span className="truncate">{tag.name}</span>
        </Badge>)}
        {!waiting && !failed && !tags.length && <span className="truncate text-xs text-muted-foreground">No personal tags</span>}
      </div>
      {remaining > 0 && <Button size="xs" variant="ghost" aria-label={`Show all ${tags.length} personal tags`} onClick={onShowAll}>+{remaining}</Button>}
      {attention && <Button size="icon-xs" variant="ghost" aria-label="Tag changes need attention" title="Tag changes need attention"
        onClick={onShowAll}><CircleAlertIcon /></Button>}
      <Button ref={trigger} size="icon-xs" variant="ghost" aria-label="Add personal tags" title="Add personal tags"
        disabled={waiting || failed || c.hostClosing} onClick={() => setOpen(true)}><PlusIcon /></Button>
      <AddTagDialog entity={entity} coordinator={c} assigned={tags} blocked={waiting || failed || c.hostClosing}
        open={open} onOpenChange={setOpen} returnFocus={trigger} />
    </section>
  )
}

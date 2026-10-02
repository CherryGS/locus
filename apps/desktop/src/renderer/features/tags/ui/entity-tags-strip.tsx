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
  const [capacity, setCapacity] = useState(1)
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => setCapacity(Math.max(0, Math.min(4, Math.floor(element.clientWidth / 150))))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const visible = tags.slice(0, capacity)
  const remaining = tags.length - visible.length
  return (
    <section aria-label="Personal tag summary" data-entity-id={entity.id}
      className="flex h-9 min-w-0 shrink-0 items-center gap-2 border-b px-3">
      <Button size="icon-xs" variant="ghost" aria-label="Show personal tags" title="Show personal tags" onClick={onShowAll}>
        <TagsIcon />
      </Button>
      <div ref={viewport} className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {waiting && <Spinner aria-label="Reading personal tags" />}
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

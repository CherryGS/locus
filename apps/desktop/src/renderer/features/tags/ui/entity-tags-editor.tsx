import { useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import { PlusIcon, TagIcon, TagsIcon, XIcon } from "lucide-react"
import { entityLabel, type EntityItem } from "@/entities/entity"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Spinner } from "@/shared/ui/spinner"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import type { TagCoordinator } from "../model/tag-coordinator"
import { tagPairBusy } from "../model/entity-tag-observation"
import { TagFeedback } from "./tag-feedback"
import { AddTagDialog } from "./add-tag-dialog"
import { useEntityTags } from "./use-entity-tags"

export function EntityTagsEditor({ entity, coordinator: c, reread }: {
  entity: EntityItem
  coordinator: TagCoordinator
  reread: () => void
}) {
  const { tags, waiting, failed, attempts } = useEntityTags(entity, c)
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const blocked = c.hostClosing || waiting || failed
  return (
    <section className="flex min-w-0 flex-col gap-3 px-4 py-3" aria-label="Personal tags" data-entity-id={entity.id}>
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {!waiting && !failed ? `${tags.length} assigned` : "Assignments"}
        </p>
        <Button ref={trigger} size="sm" variant="ghost" disabled={blocked} onClick={() => setOpen(true)}>
          <PlusIcon data-icon="inline-start" />Add tags
        </Button>
      </div>
      {waiting && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner />Reading tags…</p>}
      {failed && <Alert><AlertDescription>
        Tag metadata is unavailable{tags.length ? "; showing previous assignments" : ""}.
        <Button size="sm" variant="outline" onClick={reread}>Reread tags</Button>
      </AlertDescription></Alert>}
      <ul aria-label="Assigned tags" className="flex min-w-0 flex-col gap-1">
        {tags.map((tag) => (
          <li key={tag.id} className="flex min-w-0 items-center gap-2 rounded-lg px-1 hover:bg-muted">
            <TagIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <Link to="/tag/$tagId" params={{ tagId: tag.id }} search={{}}
              className="min-w-0 flex-1 truncate py-2 text-sm hover:underline" title={tag.name}>{tag.name}</Link>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove ${tag.name} from this Entity`}
              disabled={blocked || tagPairBusy(attempts, entity.id, tag.id)}
              onClick={() => void c.write({ operation: "remove", entity_id: entity.id, tag_id: tag.id },
                `Remove ${tag.name} from ${entityLabel(entity)}`)}>
              <XIcon />
            </Button>
          </li>
        ))}
      </ul>
      {!waiting && !failed && tags.length === 0 && <p className="text-sm text-muted-foreground">No personal tags assigned.</p>}
      <TagFeedback coordinator={c} attempts={attempts} retainAssignmentFailures />
      <Link to="/tags" search={{}} className={buttonVariants({ size: "xs", variant: "ghost", className: "self-start" })}>
        <TagsIcon data-icon="inline-start" />Manage tags
      </Link>
      <AddTagDialog entity={entity} coordinator={c} assigned={tags} blocked={blocked}
        open={open} onOpenChange={setOpen} returnFocus={trigger} />
    </section>
  )
}

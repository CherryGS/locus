import { useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import { PlusIcon, TagsIcon, XIcon } from "lucide-react"
import { entityLabel, type EntityItem } from "@/entities/entity"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
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
    <section className="flex min-w-0 flex-col gap-4 px-4 py-4" aria-label="Personal tags" data-entity-id={entity.id}>
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium" title="Assigned tags">Assigned tags</h3>
        {!waiting && !failed && <Badge variant="secondary">{tags.length}</Badge>}
        <Button ref={trigger} size="sm" variant="outline" disabled={blocked} onClick={() => setOpen(true)}>
          <PlusIcon data-icon="inline-start" />Add tags
        </Button>
      </div>
      {waiting && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner />Reading tags…</p>}
      {failed && <Alert><AlertDescription>
        Tag metadata is unavailable{tags.length ? "; showing previous assignments" : ""}.
        <Button size="sm" variant="outline" onClick={reread}>Reread tags</Button>
      </AlertDescription></Alert>}
      <div className="flex min-w-0 flex-wrap gap-2">
        {tags.map((tag) => (
          <Badge key={tag.id} variant="secondary" className="h-auto max-w-full min-w-0 gap-1 py-1">
            <Link to="/tag/$tagId" params={{ tagId: tag.id }} search={{}}
              className="min-w-0 truncate" title={tag.name}>{tag.name}</Link>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove ${tag.name} from this Entity`}
              disabled={blocked || tagPairBusy(attempts, entity.id, tag.id)}
              onClick={() => void c.write({ operation: "remove", entity_id: entity.id, tag_id: tag.id },
                `Remove ${tag.name} from ${entityLabel(entity)}`)}>
              <XIcon />
            </Button>
          </Badge>
        ))}
      </div>
      {!waiting && !failed && tags.length === 0 && <p className="text-sm text-muted-foreground">No personal tags assigned.</p>}
      <TagFeedback coordinator={c} attempts={attempts} retainAssignmentFailures />
      <Link to="/tags" search={{}} className={buttonVariants({ size: "sm", variant: "ghost" })}>
        <TagsIcon data-icon="inline-start" />Manage tags
      </Link>
      <AddTagDialog entity={entity} coordinator={c} assigned={tags} blocked={blocked}
        open={open} onOpenChange={setOpen} returnFocus={trigger} />
    </section>
  )
}

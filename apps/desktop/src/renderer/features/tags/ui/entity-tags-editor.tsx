import { useRef, useState } from "react"
import { Link } from "@tanstack/react-router"
import { PlusIcon, Settings2Icon, XIcon } from "lucide-react"
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
    <section className="flex min-w-0 flex-col gap-3 px-4 py-4" aria-label="Personal tags" data-entity-id={entity.id}>
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="text-sm font-medium">Tags</h3>
        {!waiting && !failed && <span className="text-xs tabular-nums text-muted-foreground">{tags.length}</span>}
        <Link to="/tags" search={{}} aria-label="Manage tags" title="Manage tags"
          className={buttonVariants({ size: "icon-xs", variant: "ghost", className: "ml-auto" })}>
          <Settings2Icon />
        </Link>
      </div>
      {waiting && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner />Reading tags…</p>}
      {failed && <Alert><AlertDescription>
        Tag metadata is unavailable{tags.length ? "; showing previous assignments" : ""}.
        <Button size="sm" variant="outline" onClick={reread}>Reread tags</Button>
      </AlertDescription></Alert>}
      <ul aria-label="Assigned tags" className="flex min-w-0 flex-wrap gap-1.5">
        {tags.map((tag) => (
          <li key={tag.id} className="min-w-0 max-w-full">
            <Badge variant="secondary" className="h-auto min-h-7 max-w-full gap-0.5 pl-2.5 pr-0.5">
            <Link to="/tag/$tagId" params={{ tagId: tag.id }} search={{}}
              className="min-w-0 truncate py-1 hover:underline" title={tag.name}>{tag.name}</Link>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove ${tag.name} from this Entity`}
              disabled={blocked || tagPairBusy(attempts, entity.id, tag.id)}
              onClick={() => void c.write({ operation: "remove", entity_id: entity.id, tag_id: tag.id },
                `Remove ${tag.name} from ${entityLabel(entity)}`)}>
              {tagPairBusy(attempts, entity.id, tag.id) ? <Spinner /> : <XIcon />}
            </Button>
            </Badge>
          </li>
        ))}
      </ul>
      {!waiting && !failed && tags.length === 0 && <p className="text-sm text-muted-foreground">No personal tags assigned.</p>}
      <Button ref={trigger} size="sm" variant="outline" className="w-full justify-start border-dashed" disabled={blocked} onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />Add tags
      </Button>
      <TagFeedback coordinator={c} attempts={attempts} retainAssignmentFailures showConfirmed={false} showPending={false} />
      <AddTagDialog entity={entity} coordinator={c} assigned={tags} blocked={blocked}
        open={open} onOpenChange={setOpen} returnFocus={trigger} />
    </section>
  )
}

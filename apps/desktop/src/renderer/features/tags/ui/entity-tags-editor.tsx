import { useEffect, useId, useState, useSyncExternalStore } from "react"
import { Link } from "@tanstack/react-router"
import { entityLabel, type EntityItem } from "@/entities/entity"
import { Field, FieldLabel, FieldGroup } from "@/shared/ui/field"
import { Input } from "@/shared/ui/input"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Spinner } from "@/shared/ui/spinner"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import type { TagCoordinator } from "../model/tag-coordinator"
import { TagFeedback } from "./tag-feedback"
export function EntityTagsEditor({
  entity,
  coordinator: c,
  reread,
}: {
  entity: EntityItem
  coordinator: TagCoordinator
  reread: () => void
}) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  const [find, setFind] = useState("")
  const field = useId()
  useEffect(() => {
    if (!c.vocabulary && !c.loading) void c.read()
  }, [c])
  const set = entity.components.find((v) => v.kind === "tag")
  const tags = set?.record?.tags ?? []
  const waiting =
    entity.membershipsStatus === "loading" ||
    entity.membershipsStatus === "unread" ||
    set?.readStatus === "loading"
  const failed =
    entity.membershipsStatus === "failed" ||
    entity.membershipsStatus === "missing" ||
    set?.readStatus === "failed"
  const attempts = c.attempts.filter((a) => "entity_id" in a.change && a.change.entity_id === entity.id)
  const choices = (c.vocabulary ?? []).filter(
    (t) =>
      t.name.toLocaleLowerCase().includes(find.toLocaleLowerCase()) && !tags.some((v) => v.id === t.id),
  )
  return (
    <section
      className="flex flex-col gap-3 px-4 py-4"
      aria-label="Personal tags"
      data-entity-id={entity.id}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Personal tags</h3>
        <Link to="/tags" search={{ mode: "grid", collectionId: "library" }} className={buttonVariants({ size: "sm", variant: "ghost" })}>
          Manage tags
        </Link>
      </div>
      {waiting && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner />
          Reading tags…
        </p>
      )}
      {failed && (
        <Alert>
          <AlertDescription>
            Tag metadata is unavailable{tags.length ? "; showing previous assignments" : ""}.
            <Button size="sm" variant="outline" onClick={reread}>
              Reread tags
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {tags.map((t) => (
          <Badge variant="secondary" key={t.id}>
            <span className="break-all">{t.name}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove ${t.name} from this Entity`}
              disabled={c.hostClosing || waiting || failed}
              onClick={() =>
                void c.write(
                  { operation: "remove", entity_id: entity.id, tag_id: t.id },
                  `Remove ${t.name} from ${entityLabel(entity)}`,
                )
              }
            >
              ×
            </Button>
          </Badge>
        ))}
      </div>
      {!waiting && !failed && tags.length === 0 && (
        <p className="text-xs text-muted-foreground">No personal tags assigned.</p>
      )}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={field}>Find an existing tag</FieldLabel>
          <Input
            id={field}
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Search vocabulary"
            disabled={c.hostClosing}
          />
        </Field>
      </FieldGroup>
      {c.readError && (
        <Alert>
          <AlertDescription>
            Vocabulary read failed: {c.readError}
            <Button size="sm" variant="outline" onClick={() => void c.read()}>
              Retry vocabulary
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {c.loading && <Spinner />}
      {!c.readError && (
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {choices.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant="outline"
              className="justify-start"
              disabled={c.hostClosing || waiting || failed}
              onClick={() =>
                void c.write(
                  { operation: "add", entity_id: entity.id, tag_id: t.id },
                  `Add ${t.name} to ${entityLabel(entity)}`,
                )
              }
            >
              Add {t.name}
            </Button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Each add or removal saves immediately. Create new names in Manage tags.
      </p>
      <TagFeedback coordinator={c} attempts={attempts} />
    </section>
  )
}

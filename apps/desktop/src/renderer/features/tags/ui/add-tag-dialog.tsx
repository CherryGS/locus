import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react"
import { Link } from "@tanstack/react-router"
import { CheckIcon, ChevronRightIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react"
import { entityLabel, type EntityItem } from "@/entities/entity"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Badge } from "@/shared/ui/badge"
import { Button, buttonVariants } from "@/shared/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/shared/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/shared/ui/field"
import {
  InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput,
} from "@/shared/ui/input-group"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Spinner } from "@/shared/ui/spinner"
import { tagForest, tagPath } from "../model/forest"
import type { TagAttempt, TagCoordinator } from "../model/tag-coordinator"
import { TagBreadcrumbs } from "./tag-breadcrumbs"

export function AddTagDialog({
  entity, coordinator: c, open, onOpenChange, assigned, blocked, returnFocus,
}: {
  entity: EntityItem
  coordinator: TagCoordinator
  open: boolean
  onOpenChange: (open: boolean) => void
  assigned: readonly { id: string; name: string }[]
  blocked: boolean
  returnFocus?: RefObject<HTMLElement | null>
}) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  // The owning Entity editor remounts this dialog when its subject changes.
  const [subject] = useState(() => ({ id: entity.id, label: entityLabel(entity) }))
  const [find, setFind] = useState("")
  const [parent, setParent] = useState<string | null>(null)
  const field = useId()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) void c.read()
  }, [open, c])
  const forest = useMemo(() => tagForest(c.vocabulary ?? []), [c.vocabulary])
  const paths = useMemo(
    () => new Map((c.vocabulary ?? []).map((tag) => [tag.id, tagPath(forest, tag.id).map((t) => t.name).join(" / ")])),
    [c.vocabulary, forest],
  )
  const query = find.trim().toLocaleLowerCase()
  const choices = query
    ? (c.vocabulary ?? []).filter((tag) => paths.get(tag.id)?.toLocaleLowerCase().includes(query))
    : forest.children.get(parent) ?? []
  const path = tagPath(forest, parent ?? undefined)
  const branchMissing = !!parent && !forest.byId.has(parent)
  const assignedIds = new Set(assigned.map((tag) => tag.id))
  const attempts = new Map<string, TagAttempt[]>()
  for (const attempt of c.attempts) {
    if ((attempt.change.operation === "add" || attempt.change.operation === "remove") &&
      attempt.change.entity_id === subject.id && attempt.run === c.run) {
      const id = attempt.change.tag_id
      const group = attempts.get(id) ?? []
      group.push(attempt)
      attempts.set(id, group)
    }
  }
  const visibleIds = new Set(choices.map((tag) => tag.id))
  const hiddenFeedback = [...attempts].filter(([id, group]) =>
    !visibleIds.has(id) && (group.some((attempt) => attempt.state === "pending" || attempt.state === "unconfirmed") ||
      group.at(-1)?.state === "failed"),
  )
  const disabled = blocked || c.hostClosing
  function browse(id: string | null) {
    setParent(id)
    setFind("")
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent finalFocus={returnFocus} className="flex h-[min(80dvh,40rem)] min-h-0 flex-col overflow-hidden sm:max-w-[44rem]">
        <DialogHeader className="min-w-0 shrink-0 pr-8">
          <DialogTitle>Add tags</DialogTitle>
          <DialogDescription className="truncate" title={subject.label}>
            {subject.label}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="shrink-0">
          <Field>
            <FieldLabel htmlFor={field} className="sr-only">Find an existing tag</FieldLabel>
            <InputGroup>
              <InputGroupAddon><SearchIcon aria-hidden="true" /></InputGroupAddon>
              <InputGroupInput
                ref={input}
                id={field}
                autoFocus
                value={find}
                onChange={(event) => setFind(event.target.value)}
                placeholder="Search names or paths…"
              />
              {!!find && (
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" aria-label="Clear tag search" onClick={() => {
                    setFind("")
                    input.current?.focus()
                  }}><XIcon /></InputGroupButton>
                </InputGroupAddon>
              )}
            </InputGroup>
          </Field>
        </FieldGroup>
        <div className="flex min-w-0 shrink-0 items-center gap-1">
          <Button size="xs" variant="ghost" onClick={() => browse(null)}>All tags</Button>
          {!!path.length && <TagBreadcrumbs path={path} selected={parent ?? undefined} onSelect={browse} />}
        </div>
        <ScrollArea className="min-h-0 min-w-0 flex-1" viewportProps={{ "aria-label": "Available tags" }}>
          <div className="flex min-w-0 flex-col gap-2 pr-3">
            {c.loading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner />Reading vocabulary…</p>}
            {c.readError && (
              <Alert><AlertDescription>
                <span className="break-words">Vocabulary read failed: {c.readError}{c.vocabulary ? "; showing the previous vocabulary." : "."}</span>
                <Button size="sm" variant="outline" onClick={() => void c.read()} disabled={c.loading}>Retry vocabulary</Button>
              </AlertDescription></Alert>
            )}
            {blocked && <p role="status" className="text-xs text-muted-foreground">Adding is unavailable while this Entity’s tag metadata is being read or needs recovery.</p>}
            {!query && branchMissing && c.vocabulary && (
              <Alert><AlertDescription>This tag branch is unavailable. <Button size="sm" variant="outline" onClick={() => browse(null)}>Browse roots</Button></AlertDescription></Alert>
            )}
            {c.vocabulary && choices.map((tag) => {
              const group = attempts.get(tag.id) ?? []
              const unresolved = group.some((attempt) => attempt.state === "pending" || attempt.state === "unconfirmed")
              const added = assignedIds.has(tag.id)
              const children = forest.children.get(tag.id)?.length ?? 0
              return (
                <div key={tag.id} data-add-tag-id={tag.id} className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0 flex-1" title={paths.get(tag.id)}>
                      <p className="truncate">{tag.name}</p>
                      {tag.parent && <p className="truncate text-xs text-muted-foreground">{paths.get(tag.id)}</p>}
                    </div>
                    <Button
                      size="sm" variant={added ? "ghost" : "outline"}
                      disabled={disabled || added || unresolved}
                      aria-label={added ? `${tag.name} is already assigned` : `Add ${tag.name}`}
                      onClick={() => void c.write(
                        { operation: "add", entity_id: subject.id, tag_id: tag.id },
                        `Add ${tag.name} to ${subject.label}`,
                      )}
                    >
                      {added ? <CheckIcon data-icon="inline-start" /> : unresolved ? <Spinner /> : <PlusIcon data-icon="inline-start" />}
                      {added ? "Added" : unresolved ? "Waiting" : "Add"}
                    </Button>
                    {children > 0 && <Button size="icon-sm" variant="ghost" aria-label={`Browse children of ${tag.name}`} title={`${children} children`} onClick={() => browse(tag.id)}><ChevronRightIcon /></Button>}
                  </div>
                  <AssignmentFeedback coordinator={c} attempts={group} />
                </div>
              )
            })}
            {c.vocabulary && !choices.length && (!branchMissing || query) && (
              <Empty><EmptyHeader>
                <EmptyTitle>{c.readError ? "No choices in the previous vocabulary" : !c.vocabulary.length ? "No tags yet" : query ? "No matching tags" : "No child tags"}</EmptyTitle>
                <EmptyDescription>{c.readError ? "Retry the vocabulary read to check current tags." : !c.vocabulary.length ? "Create names in Manage tags, then return here to assign them." : query ? "Try another name or part of its path." : "Browse roots or a parent to find another tag."}</EmptyDescription>
              </EmptyHeader></Empty>
            )}
            {hiddenFeedback.map(([id, group]) => <Alert key={id}><AlertDescription>
              <span className="break-words">{forest.byId.get(id)?.name ?? group.at(-1)?.label}</span>
              <AssignmentFeedback coordinator={c} attempts={group} />
            </AlertDescription></Alert>)}
          </div>
        </ScrollArea>
        <DialogFooter className="shrink-0 sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs text-muted-foreground">Each addition saves immediately.</p>
            <Link to="/tags" search={{}} className={buttonVariants({ size: "xs", variant: "link" })}>Manage tags</Link>
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AssignmentFeedback({ coordinator: c, attempts }: { coordinator: TagCoordinator; attempts: TagAttempt[] }) {
  const unresolved = attempts.filter((attempt) => attempt.state === "pending" || attempt.state === "unconfirmed")
  const latest = attempts.filter((attempt) => attempt.state === "failed" || attempt.state === "confirmed").at(-1)
  const shown = [...unresolved, ...(latest ? [latest] : [])]
  if (!shown.length) return null
  return <div className="flex min-w-0 flex-col gap-1" aria-live="polite">
    {shown.map((attempt) => <div key={attempt.request} className="flex min-w-0 flex-wrap items-center gap-2">
      <Badge variant={attempt.state === "failed" ? "destructive" : "secondary"}>
        {attempt.state === "pending" ? "Saving" : attempt.state === "unconfirmed" ? "Unconfirmed" : attempt.state === "failed" ? "Not saved" : "Saved"}
      </Badge>
      <span className="min-w-0 break-words text-xs text-muted-foreground">{attempt.message}</span>
      {attempt.state === "unconfirmed" && <Button size="xs" variant="outline" disabled={attempt.recovering || c.hostClosing} onClick={() => void c.recover(attempt)}>
        {attempt.recovering && <Spinner />}Recover original request
      </Button>}
      {attempt.uncertain && <p className="text-xs text-muted-foreground">Current reads do not prove this original commit.</p>}
    </div>)}
  </div>
}

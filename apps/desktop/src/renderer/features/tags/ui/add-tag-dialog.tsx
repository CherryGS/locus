import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react"
import { Link } from "@tanstack/react-router"
import { CheckIcon, ChevronRightIcon, PlusIcon, SearchIcon, Settings2Icon, XIcon } from "lucide-react"
import { entityLabel, type EntityItem } from "@/entities/entity"
import type { Wire } from "@/shared/api"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Button, buttonVariants } from "@/shared/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/ui/empty"
import { Field, FieldGroup, FieldLabel } from "@/shared/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/shared/ui/input-group"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Spinner } from "@/shared/ui/spinner"
import { Toggle } from "@/shared/ui/toggle"
import { cn } from "@/shared/lib/utils"
import { tagForest, tagPath, type TagForest } from "../model/forest"
import type { TagAttempt, TagCoordinator } from "../model/tag-coordinator"

type Tag = Wire<"TagRecord">

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
  const [expanded, setExpanded] = useState(new Set<string>())
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
    : forest.children.get(null) ?? []
  const assignedIds = new Set(assigned.map((tag) => tag.id))
  const attempts = new Map<string, TagAttempt[]>()
  for (const attempt of c.attempts) {
    if ((attempt.change.operation === "add" || attempt.change.operation === "remove") &&
      attempt.change.entity_id === subject.id && attempt.run === c.run) {
      const group = attempts.get(attempt.change.tag_id) ?? []
      group.push(attempt)
      attempts.set(attempt.change.tag_id, group)
    }
  }
  const pending = new Set([...attempts].filter(([, group]) =>
    group.some((attempt) => attempt.state === "pending" || attempt.state === "unconfirmed"),
  ).map(([id]) => id))
  const visibleIds = new Set<string>()
  const visible = [...choices]
  while (visible.length) {
    const tag = visible.pop()!
    visibleIds.add(tag.id)
    if (!query && expanded.has(tag.id)) visible.push(...(forest.children.get(tag.id) ?? []))
  }
  const choiceState: ChoiceState = {
    forest, expanded, paths, assigned: assignedIds, pending, attempts, coordinator: c,
    searching: !!query,
    disabled: blocked || c.hostClosing,
    expand: (id, open) => setExpanded((previous) => {
      const next = new Set(previous)
      if (open) next.add(id)
      else next.delete(id)
      return next
    }),
    toggle: (tag, added) => {
      if (blocked || c.hostClosing || pending.has(tag.id)) return
      void c.write({ operation: added ? "add" : "remove", entity_id: subject.id, tag_id: tag.id },
        `${added ? "Add" : "Remove"} ${tag.name} ${added ? "to" : "from"} ${subject.label}`)
    },
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent finalFocus={returnFocus} className="flex max-h-[80dvh] min-h-0 flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader className="shrink-0 pr-8">
          <div className="flex items-center gap-2">
            <DialogTitle>Tags</DialogTitle>
            <Link to="/tags" search={{}} aria-label="Manage tags" title="Manage tags"
              className={buttonVariants({ size: "icon-sm", variant: "ghost", className: "ml-auto" })}>
              <Settings2Icon />
            </Link>
          </div>
          <DialogDescription className="sr-only">Edit tags for {subject.label}. Changes save immediately.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="shrink-0">
          <Field>
            <FieldLabel htmlFor={field} className="sr-only">Find an existing tag</FieldLabel>
            <InputGroup>
              <InputGroupAddon><SearchIcon aria-hidden="true" /></InputGroupAddon>
              <InputGroupInput ref={input} id={field} autoFocus value={find}
                onChange={(event) => setFind(event.target.value)} placeholder="Search tags…" />
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
        <ScrollArea className="min-h-0 min-w-0" viewportProps={{
          "aria-label": "Available tags", className: "max-h-[min(28rem,calc(80dvh-8rem))]",
        }}>
          <div className="flex min-w-0 flex-col gap-1 pr-3">
            {c.loading && !c.vocabulary && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner />Loading tags…</p>}
            {c.readError && <Alert><AlertDescription>
              <span className="break-words">{c.readError}{c.vocabulary ? " Showing previously loaded tags." : ""}</span>
              <Button size="sm" variant="outline" onClick={() => void c.read()} disabled={c.loading}>Retry tags</Button>
            </AlertDescription></Alert>}
            {blocked && <p role="status" className="text-xs text-muted-foreground">Tag changes are unavailable while assignments are being read or need recovery.</p>}
            {[...attempts].filter(([id]) => !visibleIds.has(id)).map(([id, group]) => (
              <AssignmentFeedback key={id} coordinator={c} attempts={group} name={forest.byId.get(id)?.name ?? id} />
            ))}
            {choices.map((tag) => <TagChoice key={`${query ? "search" : "tree"}:${tag.id}`} tag={tag} state={choiceState} />)}
            {c.vocabulary && !choices.length && <Empty><EmptyHeader>
              <EmptyTitle>{c.vocabulary.length ? "No matching tags" : "No tags yet"}</EmptyTitle>
              <EmptyDescription>{c.vocabulary.length ? "Try another name or part of its path." : "Create tags in Manage tags."}</EmptyDescription>
            </EmptyHeader></Empty>}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

type ChoiceState = {
  forest: TagForest
  expanded: Set<string>
  paths: Map<string, string>
  assigned: Set<string>
  pending: Set<string>
  attempts: Map<string, TagAttempt[]>
  coordinator: TagCoordinator
  searching: boolean
  disabled: boolean
  expand: (id: string, open: boolean) => void
  toggle: (tag: Tag, added: boolean) => void
}

function TagChoice({ tag, state: s }: { tag: Tag; state: ChoiceState }) {
  const children = s.searching ? [] : s.forest.children.get(tag.id) ?? []
  const open = s.expanded.has(tag.id)
  const added = s.assigned.has(tag.id)
  const pending = s.pending.has(tag.id)
  const label = `${added ? "Remove" : "Add"} ${tag.name}`
  return (
    <Collapsible open={open} onOpenChange={(value) => s.expand(tag.id, value)}>
      <div data-add-tag-id={tag.id} className="flex min-w-0 items-center gap-2 py-0.5">
        {children.length ? (
          <CollapsibleTrigger render={<Button variant="ghost" className="h-10 min-w-0 flex-1 justify-start gap-2 px-2" />}
            aria-label={`${open ? "Collapse" : "Expand"} ${tag.name}`} title={tag.name}>
            <ChevronRightIcon data-icon="inline-start" className={cn(open && "rotate-90")} />
            <span className="truncate">{tag.name}</span>
          </CollapsibleTrigger>
        ) : (
          <div className={cn("flex min-h-10 min-w-0 flex-1 items-center", s.searching ? "pl-2" : "pl-8")} title={s.paths.get(tag.id)}>
            <span className="truncate">{tag.name}</span>
          </div>
        )}
        <Toggle variant="outline" className="shrink-0" pressed={added} disabled={s.disabled || pending}
          aria-label={label} title={label} aria-busy={pending}
          onPressedChange={(value) => s.toggle(tag, value)}>
          {pending ? <Spinner /> : added ? <CheckIcon /> : <PlusIcon />}
        </Toggle>
      </div>
      <AssignmentFeedback coordinator={s.coordinator} attempts={s.attempts.get(tag.id) ?? []} name={tag.name} />
      {!!children.length && <CollapsibleContent>
        <div className="ml-4 flex min-w-0 flex-col border-l pl-2">
          {children.map((child) => <TagChoice key={child.id} tag={child} state={s} />)}
        </div>
      </CollapsibleContent>}
    </Collapsible>
  )
}

function AssignmentFeedback({ coordinator: c, attempts, name }: {
  coordinator: TagCoordinator; attempts: TagAttempt[]; name: string
}) {
  const unresolved = attempts.filter((attempt) => attempt.state === "unconfirmed")
  const latest = attempts.at(-1)
  const shown = [...unresolved, ...(latest?.state === "failed" ? [latest] : [])]
  if (!shown.length) return null
  return <div className="flex min-w-0 flex-col gap-1" aria-live="polite">
    {shown.map((attempt) => <Alert key={attempt.request} variant={attempt.state === "failed" ? "destructive" : "default"}>
      <AlertDescription>
        <span className="break-words">{name}: {attempt.message}</span>
        {attempt.state === "unconfirmed" && <Button size="xs" variant="outline" disabled={attempt.recovering || c.hostClosing} onClick={() => void c.recover(attempt)}>
          {attempt.recovering && <Spinner />}Recover original request
        </Button>}
        {attempt.uncertain && <p>Current assignments do not confirm the original save.</p>}
      </AlertDescription>
    </Alert>)}
  </div>
}

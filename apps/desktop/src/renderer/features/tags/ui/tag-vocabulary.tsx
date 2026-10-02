import { useId, useState, useSyncExternalStore } from "react"
import {
  PlusIcon,
  SearchIcon,
  TagsIcon,
  PencilIcon,
  Trash2Icon,
  RefreshCwIcon,
} from "lucide-react"
import type { Wire } from "@/shared/api"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/shared/ui/input-group"
import { Input } from "@/shared/ui/input"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from "@/shared/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/ui/dialog"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/shared/ui/empty"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Separator } from "@/shared/ui/separator"
import { Spinner } from "@/shared/ui/spinner"
import type { TagCoordinator } from "../model/tag-coordinator"
import { TagFeedback } from "./tag-feedback"

export function TagVocabulary({
  coordinator: c,
  selectedId,
  onSelect,
}: {
  coordinator: TagCoordinator
  selectedId?: string
  onSelect: (id: string) => void
}) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  const prefix = useId()
  const [find, setFind] = useState("")
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [formError, setFormError] = useState<string>()
  const [editing, setEditing] = useState<{
    tag: Wire<"TagRecord">
    name: string
  }>()
  const [deleting, setDeleting] = useState<Wire<"TagRecord">>()
  const globalAttempts = c.attempts.filter((a) => !("entity_id" in a.change))
  const choices = c.vocabulary?.filter((tag) =>
    tag.name.toLocaleLowerCase().includes(find.toLocaleLowerCase()),
  )
  const blocked = c.hostClosing || c.pending
  const submit = async () => {
    setFormError(undefined)
    const result = await c.write(
      { operation: "create", name },
      `Create ${name}`,
    )
    if (result?.state === "confirmed") {
      setName("")
      setCreating(false)
    } else if (result?.state === "failed") setFormError(result.message)
  }
  return (
    <aside
      aria-label="Tag vocabulary"
      className="flex min-h-0 w-64 shrink-0 flex-col border-r bg-sidebar max-md:h-52 max-md:w-full max-md:border-r-0 max-md:border-b"
    >
      <header className="flex h-14 shrink-0 items-center gap-2 px-4">
        <TagsIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        <h1 className="flex-1 text-base font-semibold">Tags</h1>
        {c.vocabulary && (
          <Badge variant="secondary">{c.vocabulary.length}</Badge>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh vocabulary"
          title="Refresh vocabulary"
          disabled={c.loading || c.hostClosing}
          onClick={() => void c.read()}
        >
          {c.loading ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
        </Button>
      </header>
      <div className="flex shrink-0 flex-col gap-3 px-3 pb-3 max-md:flex-row max-md:items-center">
        <FieldGroup className="min-w-0 flex-1">
          <Field>
            <FieldLabel className="sr-only" htmlFor={`${prefix}-find`}>
              Find tags
            </FieldLabel>
            <InputGroup>
              <InputGroupInput
                id={`${prefix}-find`}
                value={find}
                placeholder="Find a tag…"
                onChange={(e) => setFind(e.target.value)}
              />
              <InputGroupAddon>
                <SearchIcon aria-hidden="true" />
              </InputGroupAddon>
            </InputGroup>
          </Field>
        </FieldGroup>
        <Button
          variant="outline"
          className="justify-start"
          disabled={blocked}
          onClick={() => {
            setFormError(undefined)
            setCreating(true)
          }}
        >
          <PlusIcon data-icon="inline-start" />
          New tag
        </Button>
      </div>
      <Separator />
      {c.readError && (
        <Alert variant="destructive">
          <AlertDescription>
            Vocabulary read failed: {c.readError}.{" "}
            {c.vocabulary && "Showing previous vocabulary."}
          </AlertDescription>
        </Alert>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {choices?.map((tag) => (
            <div
              key={tag.id}
              data-tag-id={tag.id}
              className="group flex items-center gap-0.5"
            >
              <Button
                variant={selectedId === tag.id ? "secondary" : "ghost"}
                className="min-w-0 flex-1 justify-start"
                aria-label={`Browse ${tag.name}`}
                aria-current={selectedId === tag.id ? "page" : undefined}
                title={tag.name}
                disabled={c.hostClosing}
                onClick={() => onSelect(tag.id)}
              >
                <span className="truncate">{tag.name}</span>
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                title={`Rename ${tag.name}`}
                aria-label={`Rename ${tag.name}`}
                disabled={blocked || !!c.readError}
                onClick={() => setEditing({ tag, name: tag.name })}
              >
                <PencilIcon data-icon="inline-start" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                title={`Delete ${tag.name} globally`}
                aria-label={`Delete ${tag.name} globally`}
                disabled={blocked || !!c.readError}
                onClick={() => setDeleting(tag)}
              >
                <Trash2Icon data-icon="inline-start" />
              </Button>
            </div>
          ))}
          {c.vocabulary?.length === 0 && !c.readError && (
            <Empty className="px-2 py-8">
              <EmptyHeader>
                <EmptyTitle>No tags yet</EmptyTitle>
                <EmptyDescription>
                  Create a tag to start organizing your library.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {!!c.vocabulary?.length && choices?.length === 0 && (
            <Empty className="px-2 py-8">
              <EmptyHeader>
                <EmptyTitle>No tags found</EmptyTitle>
                <EmptyDescription>Try another name.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {!c.vocabulary && c.loading && (
            <p className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
              <Spinner />
              Reading tags…
            </p>
          )}
        </div>
      </ScrollArea>
      {globalAttempts.length > 0 || c.unresolved.length > 0 ? (
        <div className="max-h-48 shrink-0 overflow-auto border-t p-3">
          <TagFeedback
            coordinator={c}
            attempts={c.attempts.filter(
              (a) =>
                !("entity_id" in a.change) ||
                a.state === "pending" ||
                a.state === "unconfirmed",
            )}
          />
        </div>
      ) : (
        <p className="shrink-0 px-4 py-3 text-xs text-muted-foreground max-md:hidden">
          Personal tags · shared across your library
        </p>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a tag</DialogTitle>
            <DialogDescription>
              Create a reusable personal tag, then assign it from an item's
              details.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
            className="flex flex-col gap-4"
          >
            <FieldGroup>
              <Field data-invalid={!!formError}>
                <FieldLabel htmlFor={`${prefix}-name`}>New tag name</FieldLabel>
                <Input
                  id={`${prefix}-name`}
                  value={name}
                  autoFocus
                  aria-invalid={!!formError}
                  disabled={blocked}
                  onChange={(e) => {
                    setName(e.target.value)
                    setFormError(undefined)
                  }}
                />
                <FieldDescription>
                  Names are trimmed and case-sensitive. cat and Cat are
                  different.
                </FieldDescription>
                {formError && (
                  <p role="alert" className="text-sm text-destructive">
                    {formError}
                  </p>
                )}
              </Field>
            </FieldGroup>
            <TagFeedback
              coordinator={c}
              attempts={globalAttempts.filter(
                (a) =>
                  a.change.operation === "create" &&
                  (a.state === "pending" || a.state === "unconfirmed"),
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={blocked}>
                {c.pending && <Spinner />}Create tag
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename tag everywhere</DialogTitle>
            <DialogDescription>
              The shared name changes on every annotated item. Its identity
              stays the same.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${prefix}-rename`}>Tag name</FieldLabel>
              <Input
                id={`${prefix}-rename`}
                value={editing?.name ?? ""}
                disabled={blocked}
                autoFocus
                onChange={(e) =>
                  setEditing((current) =>
                    current ? { ...current, name: e.target.value } : current,
                  )
                }
              />
            </Field>
          </FieldGroup>
          <TagFeedback
            coordinator={c}
            attempts={globalAttempts.filter(
              (a) =>
                a.change.operation === "rename" &&
                a.change.id === editing?.tag.id,
            )}
          />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={c.loading || blocked}
              onClick={() =>
                void c.read().then(() =>
                  setEditing((current) => {
                    const latest = c.vocabulary?.find(
                      (tag) => tag.id === current?.tag.id,
                    )
                    return current && latest && !c.readError
                      ? { ...current, tag: latest }
                      : current
                  }),
                )
              }
            >
              Use latest observation
            </Button>
            <Button variant="outline" onClick={() => setEditing(undefined)}>
              Cancel
            </Button>
            <Button
              disabled={blocked}
              onClick={() => {
                const captured = editing
                if (!captured) return
                void c
                  .write(
                    {
                      operation: "rename",
                      id: captured.tag.id,
                      revision: captured.tag.revision,
                      name: captured.name,
                    },
                    `Rename ${captured.tag.name}`,
                  )
                  .then((a) => {
                    if (a?.state === "confirmed")
                      setEditing((current) =>
                        current === captured ? undefined : current,
                      )
                  })
              }}
            >
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete tag globally?</DialogTitle>
            <DialogDescription>
              Delete “{deleting?.name}” and remove its assignments from all
              content. Content and other tags remain.
            </DialogDescription>
          </DialogHeader>
          <TagFeedback
            coordinator={c}
            attempts={globalAttempts.filter(
              (a) =>
                a.change.operation === "delete" && a.change.id === deleting?.id,
            )}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(undefined)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={blocked}
              onClick={() => {
                const captured = deleting
                if (!captured) return
                void c
                  .write(
                    {
                      operation: "delete",
                      id: captured.id,
                      revision: captured.revision,
                    },
                    `Delete ${captured.name} globally`,
                  )
                  .then((a) => {
                    if (a?.state === "confirmed")
                      setDeleting((current) =>
                        current === captured ? undefined : current,
                      )
                  })
              }}
            >
              Delete tag globally
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  )
}

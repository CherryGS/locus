import { PageTools } from "@/shared/page-tools"
import { useId, useMemo, useState, useSyncExternalStore } from "react"
import {
  FolderTreeIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
  ListFilterIcon,
  TriangleAlertIcon,
} from "lucide-react"
import type { Wire } from "@/shared/api"
import { Button } from "@/shared/ui/button"
import { RefreshButton } from "@/shared/ui/refresh-button"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupButton,
} from "@/shared/ui/input-group"
import { Input } from "@/shared/ui/input"
import { Field, FieldLabel, FieldDescription, FieldGroup } from "@/shared/ui/field"
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
  EmptyMedia,
  EmptyContent,
} from "@/shared/ui/empty"
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert"
import { Separator } from "@/shared/ui/separator"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverDescription,
} from "@/shared/ui/popover"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "@/shared/ui/select"
import { Spinner } from "@/shared/ui/spinner"
import type { TagCoordinator } from "../model/tag-coordinator"
import type { TagBrowsing, GeneratedDraftReceiver } from "../model/tag-browsing"
import { tagForest, tagPath, descendants } from "../model/forest"
import { TagFeedback } from "./tag-feedback"
import { TagColumns, TagLookup } from "./tag-columns"
import { TagBreadcrumbs } from "./tag-breadcrumbs"
import type { TagEditAction } from "./tag-context-menu"

const emptyRecords: Wire<"TagRecord">[] = []

type Editor = {
  operation: TagEditAction
  record?: Wire<"TagRecord">
  name: string
  parent: string
}
export function TagVocabulary({
  coordinator: c,
  browsing: b,
  generatedDraftReceiver,
  onSelect,
  onContent,
  onActivate,
}: {
  coordinator: TagCoordinator
  browsing: TagBrowsing
  generatedDraftReceiver: GeneratedDraftReceiver
  onSelect: (id: string) => void
  onContent: () => void
  onActivate: (id: string) => void
}) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  useSyncExternalStore(b.subscribe, b.snapshot)
  const prefix = useId()
  const [editor, setEditor] = useState<Editor>(),
    [formError, setFormError] = useState<string>()
  const records = c.vocabulary ?? emptyRecords,
    forest = useMemo(() => tagForest(records), [records]),
    byId = forest.byId,
    selected = b.tagId ? byId.get(b.tagId) : undefined,
    path = tagPath(forest, b.branchId ?? b.tagId)
  const blocked = c.hostClosing || c.pending,
    retained = !!c.readError
  const initialFailure = !!c.readError && c.vocabulary === undefined
  const initialLoading = c.loading && c.vocabulary === undefined && !initialFailure
  const retry = (
    <Button size="sm" variant="outline" disabled={c.loading || c.hostClosing}
      focusableWhenDisabled={c.loading && !c.hostClosing} aria-busy={c.loading} onClick={() => void c.read()}>
      Retry tags read
    </Button>
  )
  const attempts = c.attempts.filter(
    (a) => !("entity_id" in a.change) || a.state === "pending" || a.state === "unconfirmed",
  )
  const excluded =
    editor?.operation === "move" && editor.record
      ? descendants(records, editor.record.id)
      : new Set<string>()
  const parents = [
    { label: "Root · no parent", value: "" },
    ...records.filter((t) => !excluded.has(t.id)).map((t) => ({ label: t.name, value: t.id })),
  ]
  const start = (operation: Editor["operation"], record?: Wire<"TagRecord">) => {
    setFormError(undefined)
    setEditor({
      operation,
      record,
      name: operation === "rename" ? (record?.name ?? "") : "",
      parent: operation === "create" ? (record?.id ?? "") : (record?.parent ?? ""),
    })
  }
  const submit = async () => {
    const captured = editor
    if (!captured) return
    setFormError(undefined)
    const record = captured.record
    const change: Wire<"TagChange"> =
      captured.operation === "create"
        ? {
            operation: "create",
            name: captured.name,
            parent: captured.parent || null,
          }
        : captured.operation === "rename" && record
          ? {
              operation: "rename",
              id: record.id,
              revision: record.revision,
              name: captured.name,
            }
          : captured.operation === "move" && record
            ? {
                operation: "move",
                id: record.id,
                revision: record.revision,
                parent: captured.parent || null,
              }
            : {
                operation: "delete",
                id: record!.id,
                revision: record!.revision,
              }
    const result = await c.write(change, `${captured.operation} ${record?.name ?? captured.name}`)
    if (result?.state === "confirmed") {
      setEditor((current) => (current === captured ? undefined : current))
    } else if (result) setFormError(result.message)
  }
  return (
    <section aria-label="Tags" className="flex h-full min-h-0 min-w-0 flex-col">
      <h1 className="sr-only">Tags</h1>
      {selected && <h2 className="sr-only">{selected.name}</h2>}
      <div
        className="flex min-h-11 shrink-0 items-center gap-2 px-3 py-1.5"
        aria-label="Tag navigation"
      >
        <PageTools />
        {selected ? (
          <TagBreadcrumbs
            path={path}
            selected={b.tagId}
            onSelect={(id) => {
              b.find("")
              onSelect(id)
            }}
          />
        ) : (
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {b.tagId && c.vocabulary && !c.readError ? "Tag unavailable" : "Choose a tag"}
          </p>
        )}
        <Field className="w-52 shrink-0 max-sm:w-36">
          <FieldLabel className="sr-only" htmlFor={`${prefix}-find`}>
            Find tags
          </FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              id={`${prefix}-find`}
              placeholder="Find tags…"
              value={b.lookup}
              onChange={(event) => {
                b.lookupScrollTop = 0
                b.find(event.target.value)
              }}
            />
            {b.lookup && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Clear tag search"
                  onClick={() => b.find("")}
                >
                  <XIcon />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </Field>
        <RefreshButton
          aria-label="Refresh vocabulary"
          title="Refresh vocabulary"
          pending={c.loading}
          disabled={c.hostClosing}
          onClick={() => void c.read()}
        />
        {selected && (
          <Popover>
            <PopoverTrigger
              render={<Button variant="ghost" size="icon-sm" disabled={blocked || retained} />}
              aria-label="Find content"
              title={`Find content tagged ${selected.name}`}
            >
              <ListFilterIcon />
            </PopoverTrigger>
            <PopoverContent align="end">
              <PopoverHeader>
                <PopoverTitle>Find tagged content</PopoverTitle>
                <PopoverDescription>
                  Open a Filter draft, then choose Apply there.
                </PopoverDescription>
              </PopoverHeader>
              <Button
                variant="outline"
                disabled={blocked || b.pending || retained}
                onClick={() => void b.content(false, generatedDraftReceiver, onContent)}
              >
                Exactly this tag
              </Button>
              <Button
                variant="outline"
                disabled={blocked || b.pending || retained}
                onClick={() => void b.content(true, generatedDraftReceiver, onContent)}
              >
                Include descendants
              </Button>
              {b.pending && <Spinner />}
            </PopoverContent>
          </Popover>
        )}
      </div>
      <Separator />
      {c.readError && !initialFailure && (
        <Alert className="mx-3 mb-3 w-auto shrink-0">
          <TriangleAlertIcon className="text-destructive" />
          <AlertTitle>Tags refresh failed</AlertTitle>
          <AlertDescription className="flex min-w-0 flex-col items-start gap-2 [&_p:not(:last-child)]:mb-0">
            <p className="text-foreground [overflow-wrap:anywhere]">{c.readError}</p>
            <p>Showing the previous forest; refresh before editing.</p>
            {retry}
          </AlertDescription>
        </Alert>
      )}
      {b.error && (
        <Alert variant="destructive" className="mx-3 mb-3 w-auto shrink-0">
          <AlertDescription className="[overflow-wrap:anywhere]">{b.error}</AlertDescription>
        </Alert>
      )}
      {records.length ? (
        b.lookup.trim() ? (
          <TagLookup
            forest={forest}
            browsing={b}
            onSelect={onSelect}
            onActivate={onActivate}
            onEdit={start}
            blocked={blocked || retained}
          />
        ) : (
          <TagColumns
            forest={forest}
            browsing={b}
            onSelect={onSelect}
            onActivate={onActivate}
            onCreate={() => start("create")}
            onEdit={start}
            blocked={blocked || retained}
          />
        )
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">{initialLoading ? <Spinner /> : initialFailure ? <TriangleAlertIcon className="text-destructive" /> : <FolderTreeIcon />}</EmptyMedia>
            <EmptyTitle>
              {initialLoading ? "Reading tags…" : initialFailure ? "Tags unavailable" : "No tags yet"}
            </EmptyTitle>
            {initialFailure && <EmptyDescription className="[overflow-wrap:anywhere]">
              {c.readError}
            </EmptyDescription>}
          </EmptyHeader>
          {!initialLoading && (
            <EmptyContent>
              {initialFailure ? retry : (
                <Button disabled={blocked || retained} onClick={() => start("create")}>
                  <PlusIcon data-icon="inline-start" />
                  New root tag
                </Button>
              )}
            </EmptyContent>
          )}
        </Empty>
      )}
      {!!attempts.length && (
        <>
          <Separator />
          <div className="shrink-0 px-5 py-2.5">
            <TagFeedback coordinator={c} attempts={attempts} />
          </div>
        </>
      )}
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open) setEditor(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editor?.operation === "create"
                ? "Create a tag"
                : editor?.operation === "rename"
                  ? "Rename tag everywhere"
                  : editor?.operation === "move"
                    ? "Move branch"
                    : "Delete tag globally?"}
            </DialogTitle>
            <DialogDescription>
              {editor?.operation === "delete"
                ? `Delete “${editor.record?.name}” and all its direct assignments. Its immediate children move to ${editor.record?.parent ? (byId.get(editor.record.parent)?.name ?? "its parent") : "the root level"}; descendants and their annotations remain.`
                : editor?.operation === "move"
                  ? `Move “${editor.record?.name}” from ${editor.record?.parent ? (byId.get(editor.record.parent)?.name ?? "its current parent") : "the root level"}. Tag identity and direct annotations stay stable.`
                  : "Tag identity and existing direct annotations stay stable."}
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
              {(editor?.operation === "create" || editor?.operation === "rename") && (
                <Field data-invalid={!!formError}>
                  <FieldLabel htmlFor={`${prefix}-name`}>Tag name</FieldLabel>
                  <Input
                    id={`${prefix}-name`}
                    autoFocus
                    value={editor.name}
                    aria-invalid={!!formError}
                    disabled={blocked}
                    onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  />
                  <FieldDescription>
                    Trimmed, nonblank and unique everywhere. cat and Cat are different.
                  </FieldDescription>
                </Field>
              )}
              {(editor?.operation === "create" || editor?.operation === "move") && (
                <Field>
                  <FieldLabel htmlFor={`${prefix}-parent`}>Parent</FieldLabel>
                  <Select
                    items={parents}
                    value={editor.parent}
                    disabled={blocked || retained}
                    onValueChange={(value) => {
                      if (value !== null) setEditor({ ...editor, parent: value })
                    }}
                  >
                    <SelectTrigger id={`${prefix}-parent`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {parents.map((parent) => (
                          <SelectItem key={parent.value} value={parent.value}>
                            {parent.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>
                    {editor.operation === "move"
                      ? "The whole branch moves. Descendant links remain unchanged."
                      : "Choose an existing parent or create a root."}
                  </FieldDescription>
                </Field>
              )}
            </FieldGroup>
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              {editor?.record && editor.operation !== "delete" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={c.loading || blocked}
                  onClick={() =>
                    void c.read().then(() =>
                      setEditor((current) => {
                        const latest = c.vocabulary?.find((t) => t.id === current?.record?.id)
                        return current && latest && !c.readError
                          ? { ...current, record: latest }
                          : current
                      }),
                    )
                  }
                >
                  Use latest observation
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => setEditor(undefined)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={editor?.operation === "delete" ? "destructive" : "default"}
                disabled={blocked || retained}
              >
                {c.pending && <Spinner />}
                {editor?.operation === "create"
                  ? "Create tag"
                  : editor?.operation === "rename"
                    ? "Save name"
                    : editor?.operation === "move"
                      ? "Move branch"
                      : "Delete tag globally"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}

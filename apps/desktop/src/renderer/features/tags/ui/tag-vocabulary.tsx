import { useId, useMemo, useState, useSyncExternalStore } from "react"
import {
  CornerDownRightIcon,
  ChevronRightIcon,
  FolderTreeIcon,
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
  ListFilterIcon,
} from "lucide-react"
import type { Wire } from "@/shared/api"
import type { FilterCoordinator } from "@/features/entity-filter"
import { Button } from "@/shared/ui/button"
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
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/shared/ui/empty"
import { Alert, AlertDescription } from "@/shared/ui/alert"
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
import type { TagBrowsing } from "../model/tag-browsing"
import { tagForest, tagPath, descendants } from "../model/forest"
import { TagFeedback } from "./tag-feedback"
import { TagColumns, TagLookup } from "./tag-columns"

const emptyRecords: Wire<"TagRecord">[] = []

type Editor = {
  operation: "create" | "rename" | "move" | "delete"
  record?: Wire<"TagRecord">
  name: string
  parent: string
}
export function TagVocabulary({
  coordinator: c,
  browsing: b,
  filter,
  onSelect,
  onContent,
}: {
  coordinator: TagCoordinator
  browsing: TagBrowsing
  filter: FilterCoordinator
  onSelect: (id: string) => void
  onContent: () => void
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
    path = tagPath(forest, b.branchId ?? b.tagId),
    breadcrumb = path.map((tag) => tag.name).join(" / ")
  const blocked = c.hostClosing || c.pending,
    retained = !!c.readError
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
      <header className="flex shrink-0 flex-wrap items-center gap-3 px-5 py-4">
        <div className="flex min-w-44 flex-1 items-center gap-2">
          <h1 className="text-lg font-semibold">Tags</h1>
          {c.loading && <Spinner aria-label="Reading tags" />}
        </div>
        <Field className="w-64 max-md:order-last max-md:w-full">
          <FieldLabel className="sr-only" htmlFor={`${prefix}-find`}>
            Find tags
          </FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              id={`${prefix}-find`}
              placeholder="Find a tag anywhere…"
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
        <Button
          size="icon"
          variant="ghost"
          aria-label="Refresh vocabulary"
          title="Refresh vocabulary"
          disabled={c.loading || c.hostClosing}
          onClick={() => void c.read()}
        >
          <RefreshCwIcon />
        </Button>
        <Button disabled={blocked} onClick={() => start("create")}>
          <PlusIcon data-icon="inline-start" />
          New root tag
        </Button>
      </header>
      <Separator />
      {c.readError && (
        <Alert variant="destructive">
          <AlertDescription>
            Vocabulary read failed: {c.readError}.{" "}
            {c.vocabulary
              ? "Showing the previous forest; refresh before editing."
              : "Retry to read your tags."}
          </AlertDescription>
        </Alert>
      )}
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3"
        aria-label="Selected tag management"
      >
        {selected ? (
          <>
            <div className="min-w-48 flex-1">
              <h2 className="sr-only">{selected.name}</h2>
              <nav aria-label="Tag path" className="min-w-0 overflow-x-auto" title={breadcrumb}>
                <ol className="flex w-max items-center gap-1">
                  {path.map((tag, index) => (
                    <li key={tag.id} className="flex items-center gap-1">
                      {!!index && (
                        <ChevronRightIcon
                          aria-hidden="true"
                          className="size-3 text-muted-foreground"
                        />
                      )}
                      <Button
                        variant={tag.id === b.tagId ? "secondary" : "ghost"}
                        size="xs"
                        aria-label={`Locate ${tag.name}`}
                        aria-current={tag.id === b.tagId ? "location" : undefined}
                        onClick={() => {
                          b.find("")
                          onSelect(tag.id)
                        }}
                      >
                        {tag.name}
                      </Button>
                    </li>
                  ))}
                </ol>
              </nav>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={blocked || retained}
                onClick={() => start("create", selected)}
              >
                <PlusIcon data-icon="inline-start" />
                New child
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={blocked || retained}
                onClick={() => start("rename", selected)}
              >
                <PencilIcon data-icon="inline-start" />
                Rename
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={blocked || retained}
                onClick={() => start("move", selected)}
              >
                <CornerDownRightIcon data-icon="inline-start" />
                Move branch
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete tag"
                title="Delete tag"
                disabled={blocked || retained}
                onClick={() => start("delete", selected)}
              >
                <Trash2Icon />
              </Button>
              <Popover>
                <PopoverTrigger
                  render={<Button variant="outline" size="sm" disabled={blocked || retained} />}
                >
                  <ListFilterIcon data-icon="inline-start" />
                  Find content
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
                    onClick={() => void b.content(false, filter, onContent)}
                  >
                    Exactly this tag
                  </Button>
                  <Button
                    variant="outline"
                    disabled={blocked || b.pending || retained}
                    onClick={() => void b.content(true, filter, onContent)}
                  >
                    Include descendants
                  </Button>
                  {b.pending && <Spinner />}
                  <p className="text-xs text-muted-foreground">
                    Parents are never assigned to content automatically.
                  </p>
                </PopoverContent>
              </Popover>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {b.tagId && c.vocabulary && !c.readError ? "Tag unavailable" : "Choose a tag"}
            </p>
            {b.tagId && c.vocabulary && !c.readError && (
              <p className="text-xs text-muted-foreground">Select another tag or refresh.</p>
            )}
          </div>
        )}
      </div>
      {b.error && (
        <Alert variant="destructive">
          <AlertDescription>{b.error}</AlertDescription>
        </Alert>
      )}
      <Separator />
      {records.length ? (
        b.lookup.trim() ? (
          <TagLookup forest={forest} browsing={b} onSelect={onSelect} />
        ) : (
          <TagColumns
            forest={forest}
            browsing={b}
            onSelect={onSelect}
            onCreate={(parent) => start("create", parent)}
            blocked={blocked || retained}
          />
        )
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">{c.loading ? <Spinner /> : <FolderTreeIcon />}</EmptyMedia>
            <EmptyTitle>
              {c.loading ? "Reading tags…" : c.readError ? "Tags unavailable" : "No tags yet"}
            </EmptyTitle>
            <EmptyDescription>
              {c.readError
                ? "Refresh to try reading the vocabulary again."
                : "Create a root tag, then add children to organize it."}
            </EmptyDescription>
          </EmptyHeader>
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

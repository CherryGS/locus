import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CornerDownRightIcon,
  FolderTreeIcon,
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react"
import type { Wire } from "@/shared/api"
import type { FilterCoordinator } from "@/features/entity-filter"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/shared/ui/input-group"
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
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/shared/ui/card"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { ScrollArea } from "@/shared/ui/scroll-area"
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
import { forestView, descendants } from "../model/forest"
import { TagFeedback } from "./tag-feedback"

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
  const prefix = useId(),
    viewport = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<Editor>(),
    [formError, setFormError] = useState<string>()
  const records = c.vocabulary ?? [],
    byId = new Map(records.map((t) => [t.id, t]))
  const selected = b.tagId ? byId.get(b.tagId) : undefined
  const children = records.filter((t) => t.parent === selected?.id)
  const rows = forestView(records, b.expanded, b.lookup)
  const selectionVisible = rows.some((r) => r.tag.id === b.tagId)
  const blocked = c.hostClosing || c.pending,
    retained = !!c.readError
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
  useLayoutEffect(() => {
    if (viewport.current && c.vocabulary) viewport.current.scrollTop = b.scrollTop
  }, [b, c.vocabulary])
  const focus = (id?: string) => {
    if (id) viewport.current?.querySelector<HTMLElement>(`[data-tree-tag="${id}"]`)?.focus()
  }
  const submit = async () => {
    const captured = editor
    if (!captured) return
    setFormError(undefined)
    const record = captured.record
    const change: Wire<"TagChange"> =
      captured.operation === "create"
        ? { operation: "create", name: captured.name, parent: captured.parent || null }
        : captured.operation === "rename" && record
          ? { operation: "rename", id: record.id, revision: record.revision, name: captured.name }
          : captured.operation === "move" && record
            ? {
                operation: "move",
                id: record.id,
                revision: record.revision,
                parent: captured.parent || null,
              }
            : { operation: "delete", id: record!.id, revision: record!.revision }
    const result = await c.write(change, `${captured.operation} ${record?.name ?? captured.name}`)
    if (result?.state === "confirmed") {
      if (captured.operation === "create" && captured.parent) b.expanded.add(captured.parent)
      setEditor((current) => (current === captured ? undefined : current))
    } else if (result) setFormError(result.message)
  }
  return (
    <section aria-label="Tags" className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-6 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-lg font-semibold">Tags</h1>
          <p className="text-sm text-muted-foreground">Organize your personal vocabulary.</p>
        </div>
        <Button
          variant="outline"
          disabled={c.loading || c.hostClosing}
          onClick={() => void c.read()}
        >
          <RefreshCwIcon data-icon="inline-start" />
          Refresh vocabulary
        </Button>
        <Button disabled={blocked} onClick={() => start("create")}>
          <PlusIcon data-icon="inline-start" />
          New root tag
        </Button>
      </header>
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
      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <aside
          aria-label="Tag vocabulary"
          className="flex w-80 min-w-0 shrink-0 flex-col border-r max-md:h-64 max-md:w-full max-md:border-r-0 max-md:border-b"
        >
          <FieldGroup className="shrink-0 p-4">
            <Field>
              <FieldLabel htmlFor={`${prefix}-find`}>Find tags</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  id={`${prefix}-find`}
                  placeholder="Search names…"
                  value={b.lookup}
                  onChange={(e) => b.find(e.target.value)}
                />
              </InputGroup>
            </Field>
          </FieldGroup>
          <ScrollArea
            className="min-h-0 flex-1"
            viewportProps={{
              ref: viewport,
              "aria-label": "Tag tree navigation",
              onScroll: (e) => {
                if (c.vocabulary) b.scrollTop = e.currentTarget.scrollTop
              },
            }}
          >
            <div role="tree" aria-label="Tag forest" className="flex min-w-0 flex-col gap-1 p-2">
              {rows.map(({ tag, depth, hasChildren, expanded }, index) => (
                <div
                  key={tag.id}
                  role="none"
                  className="flex min-w-0 items-center gap-1"
                  style={{ paddingLeft: Math.min(depth, 12) * 14 }}
                >
                  {hasChildren ? (
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`${expanded ? "Collapse" : "Expand"} ${tag.name}`}
                      tabIndex={-1}
                      disabled={!!b.lookup}
                      onClick={() => b.toggle(tag.id)}
                    >
                      {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                    </Button>
                  ) : (
                    <span className="size-6 shrink-0" />
                  )}
                  <div
                    role="treeitem"
                    data-tree-tag={tag.id}
                    aria-level={depth + 1}
                    aria-expanded={hasChildren ? expanded : undefined}
                    aria-selected={b.tagId === tag.id}
                    aria-label={`Select ${tag.name}`}
                    className="min-w-0 flex-1 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    tabIndex={b.tagId === tag.id || (!selectionVisible && index === 0) ? 0 : -1}
                    onClick={() => onSelect(tag.id)}
                    onKeyDown={(event) => {
                      const key = event.key
                      if (key === "Enter" || key === " ") {
                        event.preventDefault()
                        onSelect(tag.id)
                      }
                      if (
                        ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(
                          key,
                        )
                      )
                        event.preventDefault()
                      if (key === "ArrowDown") focus(rows[index + 1]?.tag.id)
                      if (key === "ArrowUp") focus(rows[index - 1]?.tag.id)
                      if (key === "Home") focus(rows[0]?.tag.id)
                      if (key === "End") focus(rows.at(-1)?.tag.id)
                      if (key === "ArrowRight" && hasChildren) {
                        if (!expanded) b.toggle(tag.id)
                        else focus(rows[index + 1]?.tag.id)
                      }
                      if (key === "ArrowLeft") {
                        if (hasChildren && expanded && !b.lookup) b.toggle(tag.id)
                        else focus(tag.parent ?? undefined)
                      }
                    }}
                  >
                    <Button
                      tabIndex={-1}
                      variant={b.tagId === tag.id ? "secondary" : "ghost"}
                      className="w-full min-w-0 justify-start"
                    >
                      <span className="truncate">{tag.name}</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {!records.length && !c.readError && (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    {c.loading ? <Spinner /> : <FolderTreeIcon />}
                  </EmptyMedia>
                  <EmptyTitle>{c.loading ? "Reading tags…" : "No tags yet"}</EmptyTitle>
                  <EmptyDescription>
                    Create a root tag, then add children to organize it.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {!!records.length && !rows.length && (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No matching tags</EmptyTitle>
                  <EmptyDescription>
                    Try another name. Your selection stays available.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </ScrollArea>
          <p className="shrink-0 px-4 py-3 text-xs text-muted-foreground">
            {records.length} tags · names are unique across the library
          </p>
        </aside>
        <ScrollArea className="min-h-0 min-w-0 flex-1">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
            {selected ? (
              <>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{selected.parent ? "Child tag" : "Root tag"}</Badge>
                    {retained && <Badge variant="outline">Previous observation</Badge>}
                  </div>
                  <h2 className="break-words text-2xl font-semibold">{selected.name}</h2>
                  <p className="break-words text-sm text-muted-foreground">
                    {selected.parent
                      ? `Under ${byId.get(selected.parent)?.name ?? "Unavailable parent"}`
                      : "Top level of your vocabulary"}
                  </p>
                  <code className="break-all text-xs text-muted-foreground">{selected.id}</code>
                </div>
                <Card>
                  <CardHeader>
                    <CardTitle>Manage tag</CardTitle>
                    <CardDescription>
                      Names are globally unique and case-sensitive. Moving a tag keeps its children
                      together.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={blocked || retained}
                      onClick={() => start("create", selected)}
                    >
                      <PlusIcon data-icon="inline-start" />
                      New child
                    </Button>
                    <Button
                      variant="outline"
                      disabled={blocked || retained}
                      onClick={() => start("rename", selected)}
                    >
                      <PencilIcon data-icon="inline-start" />
                      Rename
                    </Button>
                    <Button
                      variant="outline"
                      disabled={blocked || retained}
                      onClick={() => start("move", selected)}
                    >
                      <CornerDownRightIcon data-icon="inline-start" />
                      Move branch
                    </Button>
                  </CardContent>
                  <CardFooter className="flex-wrap justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                      {children.length} direct {children.length === 1 ? "child" : "children"}
                    </p>
                    <Button
                      variant="ghost"
                      disabled={blocked || retained}
                      onClick={() => start("delete", selected)}
                    >
                      <Trash2Icon data-icon="inline-start" />
                      Delete tag
                    </Button>
                  </CardFooter>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Find content</CardTitle>
                    <CardDescription>
                      Open a Filter draft for this tag. Review the condition and choose Apply to
                      update content.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
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
                  </CardContent>
                  <CardFooter>
                    <p className="text-sm text-muted-foreground">
                      Items keep only tags you explicitly assign. Parents are never added
                      automatically.
                    </p>
                  </CardFooter>
                </Card>
                {b.error && (
                  <Alert variant="destructive">
                    <AlertDescription>{b.error}</AlertDescription>
                  </Alert>
                )}
                {!!children.length && (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">Direct children</h3>
                    <div className="flex flex-wrap gap-2">
                      {children.map((tag) => (
                        <Button
                          key={tag.id}
                          variant="outline"
                          onClick={() => {
                            b.expanded.add(selected.id)
                            onSelect(tag.id)
                          }}
                        >
                          {tag.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <Empty className="min-h-64">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FolderTreeIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    {b.tagId && c.vocabulary && !c.readError ? "Tag unavailable" : "Choose a tag"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {b.tagId && c.vocabulary && !c.readError
                      ? "This selected tag is absent from the current forest. Select another tag or refresh."
                      : "Select a tag to manage its name and place in the tree, or create a new root."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            <TagFeedback
              coordinator={c}
              attempts={c.attempts.filter(
                (a) =>
                  !("entity_id" in a.change) || a.state === "pending" || a.state === "unconfirmed",
              )}
            />
          </div>
        </ScrollArea>
      </div>
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

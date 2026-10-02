import { useId, useLayoutEffect, useRef } from "react"
import { cn } from "@/shared/lib/utils"
import { ChevronRightIcon, FolderTreeIcon, PlusIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Separator } from "@/shared/ui/separator"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import type { Wire } from "@/shared/api"
import type { TagBrowsing } from "../model/tag-browsing"
import { tagColumns, tagPath, type TagForest } from "../model/forest"

function TagCounts({
  forest,
  id,
  selected = false,
}: {
  forest: TagForest
  id: string
  selected?: boolean
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-3 text-xs tabular-nums",
        selected ? "text-primary-foreground/70" : "text-muted-foreground",
      )}
    >
      <span className="w-8 text-right" title="Direct children">
        <span className="sr-only">Children: </span>
        {forest.children.get(id)?.length ?? 0}
      </span>
      <span className="w-10 text-right" title="All descendants, excluding this tag">
        <span className="sr-only">Descendants: </span>
        {forest.counts.get(id) ?? 0}
      </span>
    </span>
  )
}

export function TagColumns({
  forest,
  browsing: b,
  onSelect,
  onCreate,
  blocked,
}: {
  forest: TagForest
  browsing: TagBrowsing
  onSelect: (id: string) => void
  onCreate: (parent?: Wire<"TagRecord">) => void
  blocked: boolean
}) {
  const prefix = useId(),
    viewport = useRef<HTMLDivElement>(null),
    previous = useRef<string | undefined>(undefined),
    pendingFocus = useRef<string | undefined>(undefined)
  const { path, columns } = tagColumns(forest, b.branchId ?? b.tagId),
    active = new Set(path.map((tag) => tag.id)),
    signature = JSON.stringify(columns.map((c) => c.parent?.id))
  const focus = (id?: string) => {
    if (!id) return
    const target = viewport.current?.querySelector<HTMLElement>(`[data-tree-tag="${id}"]`)
    if (target) target.focus()
    else pendingFocus.current = id
  }
  useLayoutEffect(() => {
    const node = viewport.current
    if (!node) return
    if (previous.current === undefined) node.scrollLeft = b.scrollLeft
    if (b.revealSelection || (previous.current !== undefined && previous.current !== signature)) {
      const branchChanged = previous.current !== undefined && previous.current !== signature,
        selected = node.querySelector<HTMLElement>(`[data-tree-tag="${b.tagId}"]`),
        target =
          branchChanged || b.tagId === b.branchId
            ? node.querySelector<HTMLElement>("[data-tag-column]:last-child")
            : selected?.closest<HTMLElement>("[data-tag-column]")
      if (target) {
        const right = target.offsetLeft + target.offsetWidth
        if (right > node.scrollLeft + node.clientWidth) node.scrollLeft = right - node.clientWidth
        else if (target.offsetLeft < node.scrollLeft) node.scrollLeft = target.offsetLeft
      }
    }
    previous.current = signature
    b.scrollLeft = node.scrollLeft
    b.revealSelection = false
    if (pendingFocus.current) {
      const id = pendingFocus.current
      pendingFocus.current = undefined
      focus(id)
    }
  })
  return (
    <ScrollArea
      className="min-h-0 min-w-0 flex-1"
      scrollbarProps={{ orientation: "horizontal" }}
      viewportProps={{
        ref: viewport,
        "aria-label": "Tag columns navigation",
        onScroll: (event) => {
          b.scrollLeft = event.currentTarget.scrollLeft
        },
      }}
    >
      <div role="tree" aria-label="Tag forest" className="flex h-full w-max min-w-full pb-3">
        {columns.map(({ parent, tags }, depth) => (
          <TagColumn
            key={parent?.id ?? "roots"}
            parent={parent}
            tags={tags}
            depth={depth}
            prefix={prefix}
            forest={forest}
            browsing={b}
            activeId={path[depth]?.id}
            nextId={path[depth + 1]?.id}
            blocked={blocked}
            onCreate={() => onCreate(parent ?? undefined)}
            onSelect={onSelect}
            focus={focus}
            active={active}
          />
        ))}
      </div>
    </ScrollArea>
  )
}

function TagColumn({
  parent,
  tags,
  depth,
  prefix,
  forest,
  browsing: b,
  activeId,
  nextId,
  blocked,
  onCreate,
  onSelect,
  focus,
  active,
}: {
  parent: Wire<"TagRecord"> | null
  tags: Wire<"TagRecord">[]
  depth: number
  prefix: string
  forest: TagForest
  browsing: TagBrowsing
  activeId?: string
  nextId?: string
  blocked: boolean
  onCreate: () => void
  onSelect: (id: string) => void
  focus: (id?: string) => void
  active: Set<string>
}) {
  const viewport = useRef<HTMLDivElement>(null),
    mounted = useRef(false),
    key = parent?.id ?? "roots"
  useLayoutEffect(() => {
    const node = viewport.current
    if (node && b.revealSelection && b.tagId && tags.some((tag) => tag.id === b.tagId))
      revealTag(node, b.tagId)
  })
  useLayoutEffect(() => {
    const node = viewport.current
    if (!node) return
    const restore = !mounted.current && b.columnScroll.has(key) && !b.revealSelection
    if (!mounted.current) node.scrollTop = b.columnScroll.get(key) ?? 0
    mounted.current = true
    const row = activeId ? node.querySelector<HTMLElement>(`[data-tree-tag="${activeId}"]`) : null
    const reveal = () => {
      if (!row) return
      if (row.offsetTop < node.scrollTop) node.scrollTop = row.offsetTop
      else if (row.offsetTop + row.offsetHeight > node.scrollTop + node.clientHeight)
        node.scrollTop = row.offsetTop + row.offsetHeight - node.clientHeight
    }
    if (!restore) reveal()
    let height = node.clientHeight
    const resize = new ResizeObserver(() => {
      // Keep a visible selection in view when wrapping toolbars reduce the space;
      // a user who scrolled away from it keeps their own browsing position.
      if (
        row &&
        node.clientHeight !== height &&
        row.offsetTop < node.scrollTop + height &&
        row.offsetTop + row.offsetHeight > node.scrollTop
      )
        reveal()
      height = node.clientHeight
    })
    resize.observe(node)
    return () => resize.disconnect()
  }, [activeId, b, key])
  return (
    <section
      data-tag-column={key}
      aria-label={parent ? `Children of ${parent.name}` : "Root tags"}
      className="flex h-full w-72 shrink-0 flex-col border-r"
    >
      <header className="flex h-16 shrink-0 items-center gap-2 px-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-xs text-muted-foreground">
            {parent ? `Level ${depth + 1}` : "Level 1"}
          </p>
          <p className="truncate text-sm font-medium" title={parent?.name}>
            {parent?.name ?? "Root tags"}
          </p>
        </div>
        <Badge variant="outline">{tags.length}</Badge>
        <Button
          size="icon-xs"
          variant="ghost"
          tabIndex={-1}
          aria-label={parent ? `Create child of ${parent.name}` : "Create root tag"}
          title={parent ? "Add a child here" : "Add a root tag"}
          disabled={blocked}
          onClick={onCreate}
        >
          <PlusIcon />
        </Button>
      </header>
      <Separator />
      <div
        aria-hidden="true"
        className="flex shrink-0 items-center gap-3 px-4 py-2 text-[10px] text-muted-foreground"
      >
        <span className="flex-1">TAG</span>
        <span className="w-8 text-right" title="Direct children">
          CHILD
        </span>
        <span className="w-10 text-right" title="All descendants, excluding this tag">
          DESC.
        </span>
        <span className="w-4" />
      </div>
      <ScrollArea
        className="min-h-0 flex-1"
        viewportProps={{
          ref: viewport,
          "aria-label": parent ? `Children navigation for ${parent.name}` : "Root tags navigation",
          onScroll: (event) => {
            b.columnScroll.set(key, event.currentTarget.scrollTop)
          },
        }}
      >
        <div role="group" id={`${prefix}-${key}`} className="flex flex-col gap-1 px-2 pb-2">
          {tags.map((tag, index) => {
            const children = forest.children.get(tag.id) ?? [],
              onPath = active.has(tag.id)
            return (
              <Button
                key={tag.id}
                role="treeitem"
                data-tree-tag={tag.id}
                aria-label={`Select ${tag.name}`}
                aria-description={`${children.length} direct children, ${forest.counts.get(tag.id) ?? 0} descendants excluding itself`}
                aria-level={depth + 1}
                aria-selected={b.tagId === tag.id}
                aria-expanded={children.length ? onPath : undefined}
                aria-owns={children.length && onPath ? `${prefix}-${tag.id}` : undefined}
                tabIndex={
                  b.tagId === tag.id ||
                  (!forest.byId.has(b.tagId ?? "") && depth === 0 && index === 0)
                    ? 0
                    : -1
                }
                variant={b.tagId === tag.id ? "default" : onPath ? "secondary" : "ghost"}
                size="lg"
                className="w-full min-w-0 justify-start gap-3"
                onClick={() => onSelect(tag.id)}
                onKeyDown={(event) => {
                  const key = event.key
                  if (
                    !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      key,
                    )
                  )
                    return
                  event.preventDefault()
                  if (key === "ArrowUp") focus(tags[index - 1]?.id)
                  if (key === "ArrowDown") focus(tags[index + 1]?.id)
                  if (key === "Home") focus(tags[0]?.id)
                  if (key === "End") focus(tags.at(-1)?.id)
                  if (key === "ArrowLeft" && parent) {
                    onSelect(parent.id)
                    focus(parent.id)
                  }
                  if (key === "ArrowRight" && children.length) {
                    const id = onPath ? (nextId ?? children[0].id) : children[0].id
                    onSelect(id)
                    focus(id)
                  }
                }}
              >
                <span className="min-w-0 flex-1 truncate text-left" title={tag.name}>
                  {tag.name}
                </span>
                <TagCounts forest={forest} id={tag.id} selected={b.tagId === tag.id} />
                {children.length ? (
                  <ChevronRightIcon data-icon="inline-end" />
                ) : (
                  <span className="w-4 shrink-0" />
                )}
              </Button>
            )
          })}
        </div>
      </ScrollArea>
    </section>
  )
}

function revealTag(viewport: HTMLElement, id: string) {
  const row = viewport.querySelector<HTMLElement>(`[data-tree-tag="${id}"]`)
  if (!row) return
  if (row.offsetTop < viewport.scrollTop) viewport.scrollTop = row.offsetTop
  else if (row.offsetTop + row.offsetHeight > viewport.scrollTop + viewport.clientHeight)
    viewport.scrollTop = row.offsetTop + row.offsetHeight - viewport.clientHeight
}

export function TagLookup({
  forest,
  browsing: b,
  onSelect,
}: {
  forest: TagForest
  browsing: TagBrowsing
  onSelect: (id: string) => void
}) {
  const viewport = useRef<HTMLDivElement>(null),
    query = b.lookup.trim().toLocaleLowerCase(),
    matches = [...forest.byId.values()].filter((tag) =>
      tag.name.toLocaleLowerCase().includes(query),
    )
  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = b.lookupScrollTop
  }, [b])
  return (
    <ScrollArea
      className="min-h-0 min-w-0 flex-1"
      viewportProps={{
        ref: viewport,
        "aria-label": "Tag search results",
        onScroll: (event) => {
          b.lookupScrollTop = event.currentTarget.scrollTop
        },
      }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {matches.length} matching {matches.length === 1 ? "tag" : "tags"} · select to reveal its
            path
          </p>
          <Button variant="ghost" size="sm" onClick={() => b.find("")}>
            Back to columns
          </Button>
        </div>
        {matches.length ? (
          <div className="flex flex-col gap-1">
            {matches.map((tag) => {
              const path = tagPath(forest, tag.id)
                .map((t) => t.name)
                .join(" / ")
              return (
                <Button
                  key={tag.id}
                  variant="ghost"
                  className="h-auto w-full min-w-0 justify-start gap-4 py-3"
                  aria-label={`Reveal ${tag.name}`}
                  onClick={() => {
                    b.revealSelection = true
                    b.find("")
                    onSelect(tag.id)
                  }}
                >
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                    <span className="max-w-full truncate">{tag.name}</span>
                    <span
                      className="max-w-full truncate text-xs font-normal text-muted-foreground"
                      title={path}
                    >
                      {path}
                    </span>
                  </span>
                  <TagCounts forest={forest} id={tag.id} />
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
              )
            })}
          </div>
        ) : (
          <Empty className="min-h-48">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderTreeIcon />
              </EmptyMedia>
              <EmptyTitle>No matching tags</EmptyTitle>
              <EmptyDescription>
                Try another name. Your selected tag stays available.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </ScrollArea>
  )
}

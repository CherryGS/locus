import { useCallback, useEffect, useState, type KeyboardEvent } from "react"
import { useRouter } from "@tanstack/react-router"
import { CornerDownLeftIcon, FileIcon, ImageIcon } from "lucide-react"
import type { EntityItem } from "@/entities/entity"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyDescription, EmptyHeader } from "@/shared/ui/empty"
import { Separator } from "@/shared/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group"
import { TitlebarActions } from "@/shared/ui/titlebar-actions"
import {
  adjacentEntity,
  exitDestination,
  inspectionDestination,
  relatedDestination,
  type EntityDestination,
  type RelatedCollection,
} from "../model/navigation"
import { availableViews, resolveView } from "../model/content-views"
import { EntityContent } from "./entity-content"
import { EntityFilmstrip } from "./entity-filmstrip"
import { EntityWorkspace } from "./entity-workspace"

export function EntityPage({
  entities,
  collections,
  destination,
  visitKey,
  navigate,
}: {
  entities: readonly EntityItem[]
  collections: readonly RelatedCollection[]
  destination: EntityDestination
  visitKey: string
  navigate: (destination: EntityDestination, replace?: boolean) => void
}) {
  const router = useRouter()
  const collection = collections.find((item) => item.id === destination.collectionId)
  const sequence =
    destination.collectionId === "library"
      ? entities
      : (collection?.entityIds
          .map((id) => entities.find((item) => item.id === id))
          .filter((item): item is EntityItem => !!item) ?? [])
  const selected = sequence.find((item) => item.id === destination.entityId) ?? null
  const viewing = destination.mode === "inspect"
  // UI-only choices while inspecting supplied specimens. How this value joins
  // Entity data and is persisted has not been designed yet.
  const [viewChoices, setViewChoices] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [override, setOverride] = useState<{ entityId: string; viewId: string } | null>(null)
  const viewId = resolveView(
    selected,
    override && override.entityId === selected?.id
      ? override.viewId
      : viewChoices.get(selected?.id ?? "") ?? null
  )
  const views = availableViews(selected)

  // Exit's source-view override belongs only to that action. History traversal
  // reconstructs the destination using the Entity's current page-local choice.
  useEffect(
    () =>
      router.history.subscribe(({ action }) => {
        if (action.type !== "PUSH" && action.type !== "REPLACE") setOverride(null)
      }),
    [router]
  )

  function move(next: EntityDestination, replace = false) {
    setOverride(null)
    navigate(next, replace)
  }
  function chooseView(viewId: string) {
    if (!selected) return
    setOverride(null)
    setViewChoices((previous) => new Map(previous).set(selected.id, viewId))
  }
  function open(entity: EntityItem) {
    if (viewing && selected?.id === entity.id) return
    move(inspectionDestination(destination, entity.id))
  }
  function adjacent(direction: -1 | 1) {
    const entity = selected && adjacentEntity(sequence, selected.id, direction)
    if (entity) open(entity)
  }
  const exit = useCallback(() => {
    const next = exitDestination(destination)
    const sourceView = destination.source?.viewId
    setOverride(next.entityId && sourceView ? { entityId: next.entityId, viewId: sourceView } : null)
    navigate(next)
  }, [destination, navigate])

  useEffect(() => {
    if (!viewing) return
    // History controls live outside the page in the titlebar. Escape must still
    // reach the active inspection after one of those controls takes focus.
    function exitOnEscape(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.key !== "Escape" || event.altKey || event.ctrlKey || event.metaKey) return
      event.preventDefault()
      exit()
    }
    window.addEventListener("keydown", exitOnEscape)
    return () => window.removeEventListener("keydown", exitOnEscape)
  }, [exit, viewing])
  function keys(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented) return
    if (!viewing || event.altKey || event.ctrlKey || event.metaKey) return
    if (
      (event.target as HTMLElement).closest(
        "input, textarea, select, [contenteditable=true], [role=separator], [role=slider], [data-slot=toggle-group]"
      )
    )
      return
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault()
      adjacent(event.key === "ArrowLeft" ? -1 : 1)
    }
  }
  const viewSelection =
    selected && views.length > 0 ? (
      <div className="flex flex-col gap-2">
        <ToggleGroup
          aria-label="Content view"
          variant="outline"
          size="sm"
          value={viewId ? [viewId] : []}
          onValueChange={(values) => {
            const value = values[0]
            if (!value) return
            chooseView(value)
          }}
        >
          {views.map((view) => (
            <ToggleGroupItem
              key={view.id}
              value={view.id}
              aria-label={`Use ${view.label} view`}
              onClick={() => {
                if (view.id === viewId) {
                  chooseView(view.id)
                }
              }}
            >
              {view.kind === "image" ? (
                <ImageIcon data-icon="inline-start" />
              ) : (
                <FileIcon data-icon="inline-start" />
              )}
              {view.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    ) : undefined
  const content = selected ? (
    <EntityContent
      key={`${visitKey}:${selected.id}:${viewId}`}
      entity={selected}
      viewId={viewId}
      entities={entities}
      collections={collections}
      onRelated={(related, entity) => move(relatedDestination(destination, related, entity.id))}
    />
  ) : (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyDescription>This Entity is unavailable in the current collection.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Entity" onKeyDown={keys}>
      {viewing && (
        <TitlebarActions>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Return to source"
            title="Return to source (Esc)"
            onClick={exit}
          >
            <CornerDownLeftIcon data-icon="inline-start" />
          </Button>
        </TitlebarActions>
      )}
      <header data-slot="entity-page-header" className="flex shrink-0 items-center px-4">
        {viewing && selected ? (
          <EntityFilmstrip
            entities={sequence}
            selectedId={selected.id}
            canNavigate={sequence.length > 1}
            viewFor={(entity) => entity.id === selected.id
              ? viewId
              : resolveView(entity, viewChoices.get(entity.id) ?? null)}
            onSelect={open}
            onNavigate={adjacent}
          />
        ) : (
          <h1 className="flex h-16 items-center text-xl font-semibold tracking-tight">Entity</h1>
        )}
      </header>
      {collection && (
        <div className="px-6 pb-2 text-xs text-muted-foreground">
          {collection.name} · from{" "}
          {entities.find((entity) => entity.id === collection.ownerId)?.name ?? "source Entity"}
        </div>
      )}
      <Separator />
      <EntityWorkspace
        entities={sequence}
        selectedEntity={selected}
        viewing={viewing}
        onSelect={(entity) => move({ ...destination, entityId: entity.id }, true)}
        onOpen={open}
        content={content}
        viewSelection={viewSelection}
      />
    </section>
  )
}

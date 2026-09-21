import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useRouter } from "@tanstack/react-router"
import { CornerDownLeftIcon, RefreshCwIcon } from "lucide-react"
import {
  componentAppearance,
  entityLabel,
  suppliedSequence,
  type EntityItem,
  type EntitySource,
  type EntityReader,
  type ReadProblem,
} from "@/entities/entity"
import type { BackendApi } from "@/shared/api"
import type { PreferenceCoordinator } from "@/features/entity-view-preferences"
import { Button } from "@/shared/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert"
import { Badge } from "@/shared/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/ui/empty"
import { Spinner } from "@/shared/ui/spinner"
import { Separator } from "@/shared/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group"
import { TitlebarActions } from "@/shared/ui/titlebar-actions"
import {
  adjacentId,
  inspectionDestination,
  relatedDestination,
  contextSequence,
  resolveReturn,
  type EntityDestination,
  type RelatedCollection,
} from "../model/navigation"
import { availableViews, resolveView } from "../model/content-views"
import { EntityContent } from "./entity-content"
import { EntityFilmstrip } from "./entity-filmstrip"
import { EntityWorkspace } from "./entity-workspace"

export function EntityPage({
  source: library,
  collections,
  destination,
  visitKey,
  navigate,
  live,
}: {
  source: EntitySource
  collections: readonly RelatedCollection[]
  destination: EntityDestination
  visitKey: string
  navigate: (destination: EntityDestination, replace?: boolean) => void
  live?: { reader: EntityReader; preferences: PreferenceCoordinator; api: BackendApi }
}) {
  const router = useRouter()
  const collection = collections.find((item) => item.id === destination.collectionId)
  const sequence = useMemo(
    () => contextSequence(destination, library.sequence, collections, suppliedSequence),
    [destination.collectionId, library.sequence, collections]
  )
  const source = { ...library, sequence: sequence ?? suppliedSequence([]) }
  const selectedIndex = useMemo(
    () => (destination.entityId && sequence ? sequence.indexOf(destination.entityId) : -1),
    [destination.entityId, sequence]
  )
  const selected = selectedIndex >= 0 && destination.entityId ? library.get(destination.entityId) : null
  const viewing = destination.mode === "inspect"
  const [previewChoices, setPreviewChoices] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [override, setOverride] = useState<{ entityId: string; viewId: string } | null>(null)
  const [explanation, setExplanation] = useState<string>()
  const currentVisit = useRef(visitKey)
  currentVisit.current = visitKey
  const preference = selected && live ? live.preferences.get(selected.id) : undefined
  const preferred =
    override?.entityId === selected?.id
      ? override?.viewId
      : (preference?.intended ??
        (preference?.observation?.status === "saved" ? preference.observation.view_definition_id : undefined) ??
        previewChoices.get(selected?.id ?? "") ??
        null)
  const viewId = resolveView(selected, preferred ?? null)
  const views = availableViews(selected)
  const preferenceWaiting =
    !!live && !!selected && !override && !preference?.intended && !preference?.observation && !preference?.readProblem
  const structureWaiting =
    !!selected?.live && (selected.membershipsStatus === "unread" || selected.membershipsStatus === "loading")
  const contentWaiting = preferenceWaiting || structureWaiting
  const failedAvailability = !!selected?.live && selected.membershipsStatus === "failed" && !selected.components.length

  useEffect(
    () =>
      router.history.subscribe(({ action }) => {
        if (action.type !== "PUSH" && action.type !== "REPLACE") {
          setOverride(null)
          setExplanation(undefined)
        }
      }),
    [router]
  )
  function move(next: EntityDestination, replace = false) {
    setOverride(null)
    setExplanation(undefined)
    navigate(next, replace)
  }
  function chooseView(id: string) {
    if (!selected) return
    setOverride(null)
    if (live) live.preferences.choose(selected.id, id)
    else setPreviewChoices((previous) => new Map(previous).set(selected.id, id))
  }
  function open(entity: EntityItem) {
    if (viewing && selected?.id === entity.id) return
    move(inspectionDestination(destination, entity.id))
  }
  function adjacent(direction: -1 | 1) {
    const id = selected && sequence && adjacentId(sequence, selected.id, direction)
    if (id) open(library.get(id))
  }
  const exit = useCallback(() => {
    const result = resolveReturn(
      destination,
      library.sequence,
      collections,
      suppliedSequence,
      !live || !!live.reader.sequence
    )
    const next = result.destination
    const sourceView = destination.source?.viewId
    setOverride(next.entityId && sourceView ? { entityId: next.entityId, viewId: sourceView } : null)
    setExplanation(result.explanation)
    navigate(next)
  }, [destination, navigate, library.sequence, collections, live?.reader.sequence])
  useEffect(() => {
    if (!viewing) return
    function exitOnEscape(event: globalThis.KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.key !== "Escape" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        document.querySelector('[data-slot="dialog-content"]')
      )
        return
      event.preventDefault()
      exit()
    }
    window.addEventListener("keydown", exitOnEscape)
    return () => window.removeEventListener("keydown", exitOnEscape)
  }, [exit, viewing])
  function keys(event: KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || !viewing || event.altKey || event.ctrlKey || event.metaKey) return
    if (
      (event.target as HTMLElement).closest(
        "input, textarea, select, video, [contenteditable=true], [role=separator], [role=slider], [data-slot=toggle-group], [data-slot=dialog-content]"
      )
    )
      return
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault()
      adjacent(event.key === "ArrowLeft" ? -1 : 1)
    }
  }
  async function refresh() {
    if (!live) return
    const requested = visitKey
    const success = await live.reader.refresh()
    if (!success || currentVisit.current !== requested) return
    const id = destination.entityId
    if (selected && destination.collectionId === "library" && id && live.reader.sequence?.indexOf(id) === -1) {
      setOverride(null)
      setExplanation("The Entity is no longer in the current list. Selection was cleared.")
      navigate({ mode: "grid", collectionId: "library" }, true)
    }
  }
  const recover = (problem: ReadProblem) => {
    if (!selected || !live) return
    if (problem.recovery === "entity") void live.reader.reread(selected.id)
    if (problem.recovery === "resource") live.reader.retryResource(selected.id)
    if (problem.recovery === "preference-read") void live.preferences.read([selected.id])
    if (problem.recovery === "preference-save") live.preferences.retry(selected.id)
    if (problem.recovery === "preference-check") void live.preferences.recover(selected.id)
  }
  const viewSelection = selected ? (
    <div className="flex flex-col gap-3">
      {!!views.length && (
        <ToggleGroup
          aria-label="Content view"
          className="max-w-full flex-wrap"
          variant="outline"
          size="sm"
          value={viewId ? [viewId] : []}
          disabled={live?.preferences.isSealed}
          onValueChange={(values) => {
            const value = values[0]
            if (value && value !== viewId) chooseView(value)
          }}
        >
          {views.map((view) => {
            const Icon = componentAppearance[view.kind].icon
            return (
              <ToggleGroupItem
                key={view.id}
                value={view.id}
                aria-label={`Use ${view.label} view`}
                onClick={() => {
                  if (view.id === viewId) chooseView(view.id)
                }}
              >
                <Icon data-icon="inline-start" />
                {view.label}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
      )}
      {preference && (
        <div className="flex flex-col gap-1 text-xs text-muted-foreground" aria-live="polite">
          <span>
            {preference.readPending
              ? "Reading saved view…"
              : preference.status === "saving"
                ? "Saving choice…"
                : preference.status === "saved"
                  ? "Choice saved"
                  : preference.status === "unsaved"
                    ? "Choice not saved"
                    : preference.status === "unconfirmed"
                      ? "Saving not confirmed"
                      : preference.observation?.status === "saved"
                        ? "Saved view observed"
                        : preference.observation?.status === "unset"
                          ? "No saved choice"
                          : "Preference unavailable"}
          </span>
          {preferred && preferred !== viewId && (!selected.live || selected.membershipsStatus === "present") && (
            <span>
              Preferred {preferred} is unavailable. Showing {viewId ?? "no preview"}; the preference is unchanged.
            </span>
          )}
        </div>
      )}
      {live && (
        <Button variant="outline" size="sm" onClick={() => void live.reader.reread(selected.id)}>
          <RefreshCwIcon data-icon="inline-start" />
          Reread Entity
        </Button>
      )}
      {!!selected.problems?.length && (
        <div className="flex flex-col gap-2" aria-label="Entity problems">
          {selected.problems.map((problem) => (
            <Alert key={problem.key} variant="destructive">
              <AlertTitle className="break-all">{problem.subject}</AlertTitle>
              <AlertDescription>
                <p>{problem.message}</p>
                {problem.previous && <p>Displayed facts are from the previous successful observation.</p>}
                <Button variant="outline" size="xs" onClick={() => recover(problem)}>
                  {problem.recovery === "preference-check"
                    ? "Check saving"
                    : problem.recovery === "preference-save"
                      ? "Retry saving"
                      : problem.recovery === "preference-read"
                        ? "Retry preference read"
                        : problem.recovery === "resource"
                          ? "Retry image"
                          : "Reread Entity"}
                </Button>
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}
    </div>
  ) : undefined
  const unavailable = (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyTitle>
          {!sequence
            ? "Collection unavailable"
            : live && !live.reader.sequence
              ? live.reader.listError
                ? "Library observation unavailable"
                : "Reading library…"
              : "Entity unavailable in this list"}
        </EmptyTitle>
        <EmptyDescription>
          {live?.reader.listError ??
            "This history visit still refers to its requested Entity and context. Continue through history or return to the source."}
          <span className="block break-all">
            Requested Entity: {destination.entityId ?? "none"} · Context: {destination.collectionId}
          </span>
        </EmptyDescription>
      </EmptyHeader>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={exit}>
          Return to source
        </Button>
        {live && (
          <Button variant="outline" onClick={() => void refresh()}>
            Retry current list
          </Button>
        )}
        {destination.entityId &&
          destination.collectionId !== "library" &&
          library.sequence.indexOf(destination.entityId) >= 0 && (
            <Button
              onClick={() =>
                move(inspectionDestination({ mode: "grid", collectionId: "library" }, destination.entityId!))
              }
            >
              Open in library
            </Button>
          )}
      </div>
    </Empty>
  )
  const content = selected ? (
    contentWaiting ? (
      <Empty className="h-full">
        <EmptyHeader>
          <Spinner />
          <EmptyDescription>Reading this Entity’s saved view and attached content…</EmptyDescription>
        </EmptyHeader>
      </Empty>
    ) : failedAvailability || selected.membershipsStatus === "missing" ? (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>Entity content unavailable</EmptyTitle>
          <EmptyDescription>
            See Overview for the actual read outcome. You can continue browsing or reread this Entity.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    ) : (
      <EntityContent
        key={`${visitKey}:${selected.id}:${viewId}`}
        entity={selected}
        viewId={viewId}
        source={library}
        collections={collections}
        live={live}
        onRelated={(related, entity) => move(relatedDestination(destination, related, entity.id))}
      />
    )
  ) : (
    unavailable
  )
  const gridFeedback = !sequence ? (
    unavailable
  ) : live && !live.reader.sequence ? (
    <Empty className="h-full">
      <EmptyHeader>
        {live.reader.listPending && <Spinner />}
        <EmptyTitle>
          {live.reader.listError ? "Unable to read the library" : "Reading complete Entity identities…"}
        </EmptyTitle>
        <EmptyDescription>{live.reader.listError}</EmptyDescription>
      </EmptyHeader>
      {live.reader.listError && <Button onClick={() => void refresh()}>Retry library read</Button>}
    </Empty>
  ) : undefined
  return (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label="Entity"
      onKeyDown={keys}
      data-metadata-cache={live?.reader.cacheSize}
      data-preference-cache={live?.preferences.cacheSize}
      data-pending-metadata={live?.reader.pendingCount}
    >
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
      <header data-slot="entity-page-header" className="flex shrink-0 items-center gap-3 px-4">
        {viewing && selected ? (
          <EntityFilmstrip
            source={source}
            selectedId={selected.id}
            canNavigate={source.sequence.length > 1}
            viewFor={(entity) => {
              const preference = live?.preferences.get(entity.id)
              return entity.id === selected.id
                ? viewId
                : resolveView(
                    entity,
                    preference?.intended ??
                      (preference?.observation?.status === "saved"
                        ? preference.observation.view_definition_id
                        : undefined) ??
                      previewChoices.get(entity.id) ??
                      null
                  )
            }}
            onSelect={open}
            onNavigate={adjacent}
          />
        ) : (
          <h1 className="flex h-16 flex-1 items-center gap-3 text-xl font-semibold tracking-tight">
            Entity <Badge variant="outline">{source.sequence.length.toLocaleString()}</Badge>
          </h1>
        )}
        {live && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Refresh library"
            title="Refresh library"
            disabled={live.reader.listPending}
            onClick={() => void refresh()}
          >
            {live.reader.listPending ? <Spinner /> : <RefreshCwIcon data-icon="inline-start" />}
          </Button>
        )}
      </header>
      {collection && (
        <div className="px-6 pb-2 text-xs text-muted-foreground">
          {collection.name} · from {entityLabel(library.get(collection.ownerId))}
        </div>
      )}
      {(explanation ||
        (!viewing && destination.entityId && !selected && sequence && (!live || live.reader.sequence))) && (
        <Alert>
          <AlertDescription>
            {explanation ?? "The recorded selection is no longer in this list. No replacement was selected."}
          </AlertDescription>
        </Alert>
      )}
      {live?.reader.listError && !!live.reader.sequence && (
        <Alert variant="destructive">
          <AlertTitle>Library refresh failed</AlertTitle>
          <AlertDescription>{live.reader.listError} The previous complete list is still shown.</AlertDescription>
        </Alert>
      )}
      <Separator />
      <EntityWorkspace
        source={source}
        selectedEntity={selected}
        viewing={viewing}
        onSelect={(entity) => move({ ...destination, entityId: entity.id }, true)}
        onOpen={open}
        content={content}
        viewSelection={viewSelection}
        gridFeedback={gridFeedback}
      />
    </section>
  )
}

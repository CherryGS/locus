import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { useRouter } from "@tanstack/react-router"
import { TriangleAlertIcon } from "lucide-react"
import {
  componentAppearance,
  entityLabel,
  suppliedSequence,
  type EntityItem,
  type EntitySource,
  type EntityReader,
  type ReadProblem,
  type IdentitySequence,
} from "@/entities/entity"
import {
  FilterModal,
  FilterResultStatus,
  FilterEvidence,
  type FilterCoordinator,
} from "@/features/entity-filter"
import { EntityTagsEditor, EntityTagsStrip, type TagCoordinator } from "@/features/tags"
import { EntityNotesEditor, type EntityNotesCoordinator } from "@/features/entity-notes"
import { errorText } from "@/shared/api"
import type { BackendApi } from "@/shared/api"
import type { PreferenceCoordinator } from "@/features/entity-view-preferences"
import { Button } from "@/shared/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert"
import { Badge } from "@/shared/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/ui/empty"
import { Spinner } from "@/shared/ui/spinner"
import { Skeleton } from "@/shared/ui/skeleton"
import { Separator } from "@/shared/ui/separator"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select"
import { useSourceReturn } from "@/shared/source-return"
import type { PlaybackCoordinator } from "@/features/video-playback"
import type { CivitaiCoordinator } from "@/features/civitai"
import type { CivitaiSelection } from "../model/navigation"
import {
  directDestination,
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
import type { EntityBrowsingState } from "../model/browsing-state"
import { EntityWorkspace } from "./entity-workspace"
import { RefreshButton } from "@/shared/ui/refresh-button"
import { EntityProblems } from "./entity-problems"

export function EntityPage({
  source: library,
  collections: suppliedCollections,
  destination,
  visitKey,
  browsing,
  navigate,
  live,
  context,
}: {
  source: EntitySource
  collections: readonly RelatedCollection[]
  destination: EntityDestination
  visitKey: string
  browsing?: EntityBrowsingState
  navigate: (destination: EntityDestination, replace?: boolean) => void
  context?: {
    id: string
    title: ReactNode
    sequence?: IdentitySequence
    pending: boolean
    error?: string
    refresh: () => Promise<unknown>
  }
  live?: {
    reader: EntityReader
    filter: FilterCoordinator
    tags: TagCoordinator
    notes: EntityNotesCoordinator
    mainDestination: EntityDestination
    preferences: PreferenceCoordinator
    api: BackendApi
    playback: PlaybackCoordinator
    civitai: CivitaiCoordinator
    relatedCollections: Map<string, RelatedCollection>
    civitaiExcursions: Map<string, CivitaiSelection>
  }
}) {
  const router = useRouter()
  const [managedCollections, setManagedCollections] = useState<RelatedCollection[]>(() => [
    ...(live?.relatedCollections.values() ?? []),
  ])
  const collections = useMemo(
    () => [...suppliedCollections, ...managedCollections],
    [suppliedCollections, managedCollections],
  )
  const excursions = useRef(live?.civitaiExcursions ?? new Map<string, CivitaiSelection>())
  const saveSelection = useCallback(
    (selection: CivitaiSelection) => {
      excursions.current.set(visitKey, selection)
    },
    [visitKey],
  )
  const collection = collections.find((item) => item.id === destination.collectionId)
  const activeContext = context?.id === destination.collectionId ? context : undefined
  const refreshLabel = activeContext ? "Refresh tag content"
    : destination.collectionId === "library" ? "Refresh library" : "Reread current Entity"
  const refreshPending = activeContext ? activeContext.pending
    : destination.collectionId === "library" && !!live?.filter.pending
  const sequence = useMemo(
    () => contextSequence(destination, library.sequence, collections, suppliedSequence, context),
    [destination.collectionId, destination.direct, destination.entityId, library.sequence, collections, context?.id, context?.sequence],
  )
  const source = { ...library, sequence: sequence ?? suppliedSequence([]) }
  const selectedIndex = useMemo(
    () => (destination.entityId && sequence ? sequence.indexOf(destination.entityId) : -1),
    [destination.entityId, sequence],
  )
  const selected = selectedIndex >= 0 && destination.entityId ? library.get(destination.entityId) : null
  const [relationship, setRelationship] = useState<{ id: string; problem?: string; ready: boolean }>()
  const [relationshipRetry, setRelationshipRetry] = useState(0)
  useEffect(() => {
    if (!live || !collection?.civitai || !destination.entityId) return
    let current = true
    const id = destination.entityId
    const scope = collection.civitai
    setRelationship({ id, ready: false })
    void live.api
      .civitaiVersion(scope.component, scope.version, scope.source)
      .then((value) => {
        if (!current) return
        const found =
          value.model === scope.model &&
          value.version.id === scope.version &&
          (!scope.source || value.in_origin || value.source.component_id === scope.source) &&
          value.examples.some(
            (e) => e.applicable && e.binding.entity_id === id && e.binding.file_id === scope.files[id],
          )
        setRelationship({
          id,
          ready: found,
          problem: found ? undefined : "The requested managed example relationship is no longer applicable.",
        })
      })
      .catch((error) => {
        if (current)
          setRelationship({
            id,
            ready: false,
            problem: error instanceof Error ? error.message : "Example relationship observation failed",
          })
      })
    return () => {
      current = false
    }
  }, [live?.api, collection, destination.entityId, relationshipRetry, live?.civitai.projectionRevision])
  const relationshipProblem =
    collection?.civitai && selected
      ? relationship?.id === selected.id
        ? (relationship.problem ??
          (selected.membershipsStatus === "present" &&
          !selected.components.some(
            (c) => c.kind === "file" && c.id === collection.civitai!.files[selected.id],
          )
            ? "This example Entity now has a different File. Its replacement bytes are not shown here."
            : undefined))
        : undefined
      : undefined
  const relationshipWaiting =
    !!collection?.civitai &&
    !relationshipProblem &&
    (!relationship?.ready || relationship.id !== selected?.id)
  const viewing = destination.mode === "inspect"
  const [previewChoices, setPreviewChoices] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [override, setOverride] = useState<{ entityId: string; viewId: string } | null>(
    browsing?.override ?? null,
  )
  const [explanation, setExplanation] = useState<string | undefined>(browsing?.explanation)
  const departure = useRef({ browsing, override, explanation })
  departure.current = { browsing, override, explanation }
  useEffect(
    () => () => {
      // Retain the departing page only. Ordinary within-Entity navigation keeps
      // its existing override/source-return and history-reset semantics.
      const { browsing, override, explanation } = departure.current
      if (browsing) {
        browsing.override = override
        browsing.explanation = explanation
      }
    },
    [],
  )
  const currentVisit = useRef(visitKey)
  currentVisit.current = visitKey
  const previousResult = useRef(live?.filter.sequence)
  useEffect(() => {
    const previous = previousResult.current
    previousResult.current = live?.filter.sequence
    // Only a selection lost from an established result is cleared. A history
    // target already outside that result stays at its requested unavailable visit.
    if (
      previous &&
      previous !== live?.filter.sequence &&
      destination.collectionId === "library" &&
      destination.entityId &&
      previous.indexOf(destination.entityId) >= 0 &&
      sequence &&
      sequence.indexOf(destination.entityId) < 0
    ) {
      setOverride(null)
      setExplanation("The Entity is no longer in the current list. Selection was cleared.")
      navigate({ mode: "grid", collectionId: "library" }, true)
    }
  }, [live?.filter.sequence, destination, sequence, navigate])
  const previousContextResult = useRef(context?.sequence)
  useEffect(() => {
    const previous = previousContextResult.current
    previousContextResult.current = context?.sequence
    if (context && previous && previous !== context.sequence && context.sequence &&
      destination.collectionId === context.id && destination.entityId &&
      previous.indexOf(destination.entityId) >= 0 && context.sequence.indexOf(destination.entityId) < 0) {
      setOverride(null)
      setExplanation("The Entity is no longer in the refreshed Tag result. Selection was cleared.")
      navigate({ mode: "grid", collectionId: context.id }, true)
    }
  }, [context?.id, context?.sequence, destination, navigate])
  const preference = selected && live ? live.preferences.get(selected.id) : undefined
  const preferred =
    override?.entityId === selected?.id
      ? override?.viewId
      : (preference?.intended ??
        (preference?.observation?.status === "saved"
          ? preference.observation.view_definition_id
          : undefined) ??
        previewChoices.get(selected?.id ?? "") ??
        null)
  const viewId = resolveView(selected, preferred ?? null)
  function viewFor(entity: EntityItem) {
    const preference = live?.preferences.get(entity.id)
    return entity.id === selected?.id
      ? viewId
      : resolveView(
          entity,
          preference?.intended ??
            (preference?.observation?.status === "saved"
              ? preference.observation.view_definition_id
              : undefined) ??
            previewChoices.get(entity.id) ??
            null,
        )
  }
  function componentFor(entity: EntityItem) {
    const preference = live?.preferences.get(entity.id)
    if (live && !preference?.observation && !preference?.intended && !preference?.readProblem)
      return undefined
    return availableViews(entity).find((view) => view.id === viewFor(entity))?.kind
  }
  const views = availableViews(selected)
  const preferenceWaiting =
    !!live &&
    !!selected &&
    !override &&
    !preference?.intended &&
    !preference?.observation &&
    !preference?.readProblem
  const structureWaiting =
    !!selected?.live && (selected.membershipsStatus === "unread" || selected.membershipsStatus === "loading")
  const contentWaiting = preferenceWaiting || structureWaiting
  const failedAvailability =
    !!selected?.live && selected.membershipsStatus === "failed" && !selected.components.length

  useEffect(
    () =>
      router.history.subscribe(({ action }: { action: { type: string } }) => {
        if (action.type !== "PUSH" && action.type !== "REPLACE") {
          setOverride(null)
          setExplanation(undefined)
        }
      }),
    [router],
  )
  function move(next: EntityDestination, replace = false) {
    setOverride(null)
    setExplanation(undefined)
    navigate(next, replace)
  }
  function chooseView(id: string) {
    if (!selected) return
    setOverride(null)
    excursions.current.delete(visitKey)
    if (destination.civitai) navigate({ ...destination, civitai: undefined }, true)
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
      !live || !!live.filter.sequence,
      context,
    )
    const next = result.destination
    const sourceView = destination.source?.viewId
    setOverride(next.entityId && sourceView ? { entityId: next.entityId, viewId: sourceView } : null)
    setExplanation(result.explanation)
    navigate(next)
  }, [destination, navigate, library.sequence, collections, live?.filter.sequence, context?.id, context?.sequence])
  useSourceReturn(viewing ? exit : undefined)
  useEffect(() => {
    if (!viewing) return
    function exitOnEscape(event: globalThis.KeyboardEvent) {
      if (
        event.defaultPrevented ||
        document.fullscreenElement ||
        event.key !== "Escape" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.target instanceof Element &&
          event.target.closest('[role="combobox"], [data-slot="select-content"]')) ||
        document.querySelector('[data-slot="dialog-content"][data-open]')
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
        "input, textarea, select, video, [contenteditable=true], [role=separator], [role=slider], [role=combobox], [role=listbox], [data-slot=toggle-group], [data-slot=dialog-content]",
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
    if (context && destination.collectionId === context.id) { await context.refresh(); return }
    if (destination.collectionId !== "library") {
      if (destination.entityId) void live.reader.reread(destination.entityId)
      setRelationshipRetry((value) => value + 1)
      return
    }
    await live.filter.refresh()
  }
  const recover = (problem: ReadProblem) => {
    if (!selected || !live) return
    if (problem.recovery === "entity") void live.reader.reread(selected.id)
    if (problem.recovery === "resource") {
      if (problem.key.includes(":cover-dependent:")) live.reader.retryBilibiliCover(selected.id)
      else live.reader.retryResource(selected.id, problem.key.slice("resource:".length))
    }
    if (problem.recovery === "preference-read") void live.preferences.read([selected.id])
    if (problem.recovery === "preference-save") live.preferences.retry(selected.id)
    if (problem.recovery === "preference-check") void live.preferences.recover(selected.id)
  }
  const preferenceStatus = preference
    ? preference.readPending
      ? "Reading saved view…"
      : preference.status === "saving"
        ? "Saving choice…"
        : preference.status === "saved"
          ? undefined
          : preference.status === "unsaved"
            ? "Choice not saved"
            : preference.status === "unconfirmed"
              ? "Saving not confirmed"
              : preference.observation?.status === "saved"
                ? undefined
                : preference.observation?.status === "unset"
                  ? "No saved choice"
                  : "Preference unavailable"
    : undefined
  const preferenceFeedback = preferenceStatus && (
    <span
      role="status"
      aria-label={preferenceStatus}
      title={preferenceStatus}
      className="flex min-w-0 max-w-[55%] items-center gap-1 text-xs font-normal text-muted-foreground"
    >
      {(preference?.readPending || preference?.status === "saving") && <Spinner />}
      <span className="truncate">{preferenceStatus}</span>
    </span>
  )
  const viewSelection = selected ? (
    <div className="flex flex-col gap-3" data-slot="entity-view-choice" data-save-state={preference?.status ?? "idle"}>
      {!!views.length && (
        <Select
          items={views.map((view) => ({ value: view.id, label: view.label }))}
          value={viewId}
          disabled={live?.preferences.isSealed}
          onValueChange={(value) => {
            if (value && value !== viewId) chooseView(value)
          }}
        >
          <SelectTrigger aria-label="Default view" className="w-full min-w-0">
            <SelectValue placeholder="Choose a view" className="min-w-0 truncate" />
            {preferenceFeedback}
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {views.map((view) => {
                const Icon = componentAppearance[view.kind].icon
                return (
                  <SelectItem
                    key={view.id}
                    value={view.id}
                    aria-label={`Use ${view.label} view`}
                    onClick={() => {
                      if (view.id === viewId) chooseView(view.id)
                    }}
                  >
                    <Icon data-icon="inline-start" />
                    {view.label}
                  </SelectItem>
                )
              })}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
      {!views.length && (
        <p className="text-xs text-muted-foreground">
          {selected.loading || structureWaiting
            ? "Views will appear as components are read."
            : selected.membershipsStatus === "failed"
              ? "Content views could not be determined."
              : selected.membershipsStatus === "missing"
                ? "Entity unavailable."
                : "No content views available."}
        </p>
      )}
      {!views.length && preferenceFeedback}
      {preference &&
        preferred &&
        preferred !== viewId &&
        (!selected.live || selected.membershipsStatus === "present") && (
          <p className="text-xs text-muted-foreground">
            Preferred {preferred} is unavailable. Showing {viewId ?? "no preview"}; the preference is
            unchanged.
          </p>
        )}
    </div>
  ) : undefined
  const [recoveryError, setRecoveryError] = useState<string>()
  const [recoveryPending, setRecoveryPending] = useState(false)
  const recoveryIntent = useRef(0)
  useEffect(() => {
    recoveryIntent.current++
    setRecoveryPending(false)
    setRecoveryError(undefined)
    return () => {
      recoveryIntent.current++
    }
  }, [visitKey])
  async function openDirect() {
    if (!live || !destination.entityId) return
    const visit = visitKey
    const intent = ++recoveryIntent.current
    const current = () =>
      currentVisit.current === visit && recoveryIntent.current === intent && !live.filter.hostClosing
    setRecoveryPending(true)
    setRecoveryError(undefined)
    try {
      if (!(await live.api.entityPresent(destination.entityId)))
        throw new Error("The requested Entity is no longer available.")
      if (current()) move(directDestination(destination.entityId, live.mainDestination))
    } catch (error) {
      if (current()) setRecoveryError(errorText(error))
    } finally {
      if (currentVisit.current === visit && recoveryIntent.current === intent) setRecoveryPending(false)
    }
  }
  const directRecovery = live && destination.entityId && !destination.direct && (
    <>
      <Button disabled={recoveryPending} onClick={() => void openDirect()}>
        {recoveryPending ? "Checking Entity…" : "Open direct Entity"}
      </Button>
      {recoveryError && <p role="alert">{recoveryError}</p>}
    </>
  )
  const unavailable = (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyTitle>
          {context && destination.collectionId === context.id && !sequence
            ? context.pending ? "Finding tagged content…" : "Tag context unavailable"
            : !sequence
            ? "Collection unavailable"
            : live && destination.collectionId === "library" && !live.filter.sequence
              ? live.filter.resultError || !live.filter.pending
                ? "Library observation unavailable"
                : "Reading library…"
              : "Entity unavailable in this list"}
        </EmptyTitle>
        <EmptyDescription>
          {(context && destination.collectionId === context.id ? context.error : destination.collectionId === "library" ? live?.filter.resultError : undefined) ??
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
        {directRecovery}
      </div>
    </Empty>
  )
  const content = selected ? (
    relationshipProblem ? (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Managed example unavailable</EmptyTitle>
          <EmptyDescription>{relationshipProblem}</EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" onClick={() => setRelationshipRetry((v) => v + 1)}>
          Retry relationship read
        </Button>
        <Button variant="outline" onClick={exit}>
          Return to source
        </Button>
        {directRecovery}
      </Empty>
    ) : contentWaiting || relationshipWaiting ? (
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
        componentFor={componentFor}
        key={`${visitKey}:${selected.id}:${viewId}`}
        entity={selected}
        viewId={viewId}
        source={library}
        collections={collections}
        live={live}
        civitaiSelection={excursions.current.get(visitKey) ?? destination.civitai}
        onCivitaiSelection={saveSelection}
        onRelated={(related, entity) => {
          live?.relatedCollections.set(related.id, related)
          setManagedCollections((previous) => [...previous.filter((c) => c.id !== related.id), related])
          move(
            relatedDestination(
              { ...destination, civitai: excursions.current.get(visitKey) },
              related,
              entity.id,
            ),
          )
        }}
      />
    )
  ) : (
    unavailable
  )
  const gridFeedback = context && destination.collectionId === context.id && sequence?.length === 0 ? (
    <Empty className="h-full"><EmptyHeader><EmptyTitle>No tagged content</EmptyTitle>
      <EmptyDescription>This tag has no matching items in the complete result. Assign it from an item's details, then refresh this list.</EmptyDescription>
    </EmptyHeader></Empty>
  ) : !sequence ? (
    unavailable
  ) : live && destination.collectionId === "library" && !live.filter.sequence ? (
    <Empty className="h-full">
      <EmptyHeader>
        {live.filter.pending && <Spinner />}
        <EmptyTitle>
          {live.filter.pending
            ? "Reading complete Entity identities…"
            : live.filter.resultError
              ? "Unable to read the library"
              : "No library result loaded"}
        </EmptyTitle>
        <EmptyDescription>
          {live.filter.resultError ??
            (!live.filter.pending
              ? "The previous read was superseded. Retry the library read or apply a Filter to begin browsing."
              : undefined)}
        </EmptyDescription>
      </EmptyHeader>
      {!live.filter.pending && <Button onClick={() => void refresh()}>Retry library read</Button>}
    </Empty>
  ) : live?.filter.filtered && sequence.length === 0 && destination.collectionId === "library" ? (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyTitle>No matches</EmptyTitle>
        <EmptyDescription>
          This complete Filter result has no matching Entities. Open Filter to adjust the draft or Clear and
          Apply to return to the library.
        </EmptyDescription>
      </EmptyHeader>
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
      <header data-slot="entity-page-header" className="flex shrink-0 items-center gap-3 px-4">
        {viewing && selected ? (
          <EntityFilmstrip
            source={source}
            selectedId={selected.id}
            canNavigate={source.sequence.length > 1}
            viewFor={viewFor}
            onSelect={open}
            onNavigate={adjacent}
          />
        ) : (
          <div className="flex h-10 min-w-0 flex-1 items-center gap-2">
            <h1 className="min-w-0 truncate text-sm leading-none font-medium">
              {activeContext ? activeContext.title : "Entity"}
            </h1>
            {sequence && (destination.collectionId !== "library" || !live || live.filter.sequence) ? (
              <Badge variant="secondary" className="py-0 text-sm leading-none tabular-nums">{source.sequence.length.toLocaleString()}</Badge>
            ) : (
              <Skeleton className="h-5 w-8" />
            )}
            {selected && (
              <span className="shrink-0 whitespace-nowrap text-sm leading-none text-muted-foreground">1 selected</span>
            )}
          </div>
        )}
        {!viewing && destination.collectionId === "library" && live && (
          <FilterModal coordinator={live.filter} />
        )}
        {live && (
          <RefreshButton
            aria-label={refreshLabel}
            title={refreshLabel}
            pending={!!refreshPending}
            onClick={() => void refresh()}
          />
        )}
      </header>
      {destination.direct && (
        <p className="px-4 pb-2 text-xs text-muted-foreground">
          Direct Entity · temporary single-Entity view
        </p>
      )}
      {live && destination.collectionId === "library" && (
        <FilterResultStatus coordinator={live.filter} />
      )}
      {collection && (
        <div className="px-4 pb-2 text-xs text-muted-foreground">
          {collection.name} · from {entityLabel(library.get(collection.ownerId))}
        </div>
      )}
      {(explanation ||
        (!viewing && destination.entityId && !selected && sequence && (!live || live.filter.sequence))) && (
        <Alert>
          <AlertDescription>
            {explanation ?? "The recorded selection is no longer in this list. No replacement was selected."}
          </AlertDescription>
        </Alert>
      )}
      {destination.collectionId === "library" && live?.filter.resultError && !!live.filter.sequence && (
        <Alert className="mx-4 mb-2 w-auto shrink-0">
          <TriangleAlertIcon className="text-destructive" />
          <AlertTitle>Library refresh failed</AlertTitle>
          <AlertDescription className="flex min-w-0 flex-col items-start gap-2 [&_p:not(:last-child)]:mb-0">
            <p className="text-foreground [overflow-wrap:anywhere]">{live.filter.resultError}</p>
            <p>The previous complete list is still shown.</p>
            <Button size="sm" variant="outline" disabled={!!live.filter.pending}
              focusableWhenDisabled={!!live.filter.pending} aria-busy={!!live.filter.pending}
              onClick={() => void refresh()}>Retry library read</Button>
          </AlertDescription>
        </Alert>
      )}
      <Separator />
      <EntityWorkspace
        componentFor={componentFor}
        browsing={browsing}
        source={source}
        selectedEntity={selected}
        viewing={viewing}
        onSelect={(entity) => move({ ...destination, entityId: entity.id }, true)}
        onOpen={open}
        content={content}
        viewSelection={viewSelection}
        personalTags={selected && live ? (
          <EntityTagsEditor key={selected.id} entity={selected} coordinator={live.tags}
            reread={() => void live.reader.reread(selected.id)} />
        ) : undefined}
        notes={selected && live ? (
          <EntityNotesEditor key={selected.id} entityId={selected.id} coordinator={live.notes} />
        ) : undefined}
        tagSummary={selected && live ? (onShowAll) => (
          <EntityTagsStrip key={selected.id} entity={selected} coordinator={live.tags} onShowAll={onShowAll} />
        ) : undefined}
        overviewFeedback={
          <>
            {!!selected?.problems?.length && (
              <EntityProblems problems={selected.problems} recover={recover} />
            )}
            {selected && live && destination.collectionId === "library" && (
              <FilterEvidence coordinator={live.filter} entity={selected.id} />
            )}
          </>
        }
        onReread={selected && live ? () => {
          void live.reader.reread(selected.id)
          void live.notes.read(live.notes.get(selected.id))
        } : undefined}
        gridFeedback={gridFeedback}
      />
    </section>
  )
}

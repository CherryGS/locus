import { createFileRoute, useBlocker } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"
import { emptySequence } from "@/entities/entity"
import { TagDetailPage, TagEntityStrip } from "@/pages/tag-detail"
import { EntityPage, entitySearch, type EntityDestination, type EntityBrowsingState } from "@/pages/entity"
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group"
import { Button } from "@/shared/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/ui/dialog"
import { useLibrarySession } from "../providers/library-provider"

export const Route = createFileRoute("/tag/$tagId")({
  validateSearch: (search): Partial<EntityDestination> => {
    if (search.mode !== "inspect") return {}
    return entitySearch({
      ...search,
      collectionId: typeof search.collectionId === "string" ? search.collectionId : "tag",
    })
  },
  beforeLoad: ({ location }) => ({ visit: location.state }),
  component: TagRoute,
})
const noSubscribe = () => () => {},
  zero = () => 0
function TagRoute() {
  const session = useLibrarySession(),
    { tagId } = Route.useParams(),
    search = Route.useSearch(),
    navigate = Route.useNavigate()
  const contextId = `tag:${tagId}`
  const destination: EntityDestination = {
    ...search,
    mode: search.mode ?? "grid",
    collectionId: !search.collectionId || search.collectionId === "tag" ? contextId : search.collectionId,
  }
  const visitKey = Route.useRouteContext().visit.__TSR_key ?? "initial"
  const browsing = useMemo(() => {
    const state: EntityBrowsingState = session?.browsing.get(visitKey) ?? {}
    session?.browsing.set(visitKey, state)
    return state
  }, [session, visitKey])
  const c = session?.tagDetails,
    s = c?.state(tagId)
  useSyncExternalStore(c?.subscribe ?? noSubscribe, c?.snapshot ?? zero)
  useSyncExternalStore(session?.reader.subscribe ?? noSubscribe, session?.reader.snapshot ?? zero)
  useSyncExternalStore(session?.preferences.subscribe ?? noSubscribe, session?.preferences.snapshot ?? zero)
  useSyncExternalStore(session?.civitai.subscribe ?? noSubscribe, session?.civitai.snapshot ?? zero)
  useSyncExternalStore(session?.covers.subscribe ?? noSubscribe, session?.covers.snapshot ?? zero)
  const get = useCallback((id: string) => session!.get(id), [session])
  const demand = useCallback((ids: string[]) => session?.demand(ids), [session])
  useEffect(() => {
    if (!c || !s) return
    session?.tagBrowsing.select(tagId)
    if (session && !session.tags.vocabulary) void session.tags.read()
    void c.read(s)
    if (!s.sequence) void c.query(s)
    return () => c.suspend(s)
  }, [c, s])
  const returning = useCallback(() => {
    if (session) session.tagBrowsing.revealSelection = true
    void navigate({ to: "/tags", search: { tag: session?.tagBrowsing.tagId ?? tagId } })
  }, [session, navigate, tagId])
  const blocker = useBlocker({
    withResolver: true,
    enableBeforeUnload: () => !!(c && s && (c.dirty(s) || c.unresolved(s))),
    shouldBlockFn: ({ current, next }) => {
      const currentMode = "mode" in current.search ? current.search.mode : "grid"
      const nextMode = "mode" in next.search ? next.search.mode : "grid"
      return !!(c && s && (next.pathname !== current.pathname || nextMode !== currentMode) &&
        (c.dirty(s) || c.unresolved(s)))
    },
  })
  if (!session || !c || !s) return null
  const translate = (destination: EntityDestination): EntityDestination => ({ ...destination,
    collectionId: destination.collectionId === contextId ? "library" : destination.collectionId,
    source: destination.source ? translate(destination.source) : undefined })
  const openInNewTab = (destination: EntityDestination) => session.run.workspace.handoff(session,
    translate(destination), s.sequence ?? emptySequence, s.document?.tag.name,
    { sequence: s.sequence ?? emptySequence, criteria: s.appliedSource, filterCriteria: s.appliedSource })
  const source = { sequence: s.sequence ?? emptySequence, get, demand,
    openInNewTab: (entityId: string) => openInNewTab({ mode: "inspect", collectionId: contextId, entityId,
      source: { mode: "grid", collectionId: contextId } }) }
  const move = (next: EntityDestination, replace?: boolean) => {
    if (next.collectionId === "library") {
      void navigate({ to: "/entity", search: next, replace })
      return
    }
    if (next.collectionId === contextId && next.entityId) c.selectEntity(s, next.entityId)
    void navigate({ search: next.mode === "grid" && next.collectionId === contextId ? {} : next, replace })
  }
  const controls = (
    <ToggleGroup
      aria-label="Tag entity scope"
      size="sm"
      variant="outline"
      value={[s.requestedScope ? "inclusive" : "direct"]}
      disabled={session.tags.hostClosing}
      onValueChange={(value) => {
        if (value.length) void c.query(s, value[0] === "inclusive")
      }}
    >
      <ToggleGroupItem value="direct">This tag</ToggleGroupItem>
      <ToggleGroupItem value="inclusive">Include descendants</ToggleGroupItem>
    </ToggleGroup>
  )
  return (
    <>
      {destination.mode === "inspect" ? (
        <EntityPage
          source={source}
          openInNewTab={openInNewTab}
          collections={[]}
          destination={destination}
          visitKey={visitKey}
          browsing={browsing}
          navigate={move}
          context={{ id: contextId, title: s.document?.tag.name ?? "Tag", sequence: s.sequence,
            pending: s.queryPending, error: s.queryError, refresh: () => c.query(s) }}
          live={{ reader: session.reader, filter: session.filter, tags: session.tags, notes: session.notes,
            mainDestination: session.mainDestination, preferences: session.preferences, api: session.api,
            playback: session.playback, civitai: session.civitai, covers: session.covers, relatedCollections: session.relatedCollections,
            civitaiExcursions: session.civitaiExcursions }}
        />
      ) : <TagDetailPage
        coordinator={c}
        state={s}
        controls={controls}
        onRefresh={() => {
          if (!s.editing) void c.read(s)
          void c.query(s)
        }}
        onReturn={returning}
        entities={
          <TagEntityStrip
            source={source}
            selectedId={s.entityId}
            position={s.grid}
            onPosition={(position) => { s.grid = position }}
            onSelect={(entity) => c.selectEntity(s, entity.id)}
            onOpen={(entity) => {
              // Capture even an unscrolled grid so returning restores keyboard focus.
              s.grid ??= { anchor: source.sequence.at(0), offset: 0, logical: 0 }
              move({ mode: "inspect", collectionId: contextId, entityId: entity.id,
                source: { mode: "grid", collectionId: contextId } })
            }}
            pending={s.queryPending}
            established={!!s.sequence}
            error={s.queryError}
            retained={
              s.sequence && (s.queryError || s.scope !== s.requestedScope)
                ? `Showing the previous ${s.scope ? "inclusive" : "direct"} result.`
                : undefined
            }
          />
        }
      />}
      <Dialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved description</DialogTitle>
            <DialogDescription>
              {c.unresolved(s)
                ? "The document save is not confirmed. Recover the original request before leaving."
                : "Save your changes before leaving this tag?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => blocker.reset?.()}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={c.unresolved(s)}
              onClick={() => {
                if (c.discard(s)) blocker.proceed?.()
              }}
            >
              Discard
            </Button>
            {s.attempt?.state === "unconfirmed" ? (
              <Button disabled={s.attempt.recovering} onClick={() => void c.recover(s)}>
                Recover original request
              </Button>
            ) : (
              <Button
                disabled={c.unresolved(s) || !c.editable}
                onClick={() =>
                  void c.save(s).then((saved) => {
                    if (saved) blocker.proceed?.()
                  })
                }
              >
                Save
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

import { createFileRoute, useBlocker, useRouterState } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"
import { EntityPage, entitySearch, type EntityBrowsingState } from "@/pages/entity"
import { TagDetailPage } from "@/pages/tag-detail"
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group"
import { Alert, AlertDescription } from "@/shared/ui/alert"
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
  validateSearch: (search: Record<string, unknown>) => ({
    ...entitySearch(search),
    collectionId: typeof search.collectionId === "string" ? search.collectionId : "",
  }),
  component: TagRoute,
})
const noSubscribe = () => () => {},
  zero = () => 0
function TagRoute() {
  const session = useLibrarySession(),
    { tagId } = Route.useParams(),
    search = Route.useSearch(),
    navigate = Route.useNavigate()
  const destination = { ...search, collectionId: search.collectionId || `tag:${tagId}` }
  const c = session?.tagDetails,
    s = c?.state(tagId)
  useSyncExternalStore(c?.subscribe ?? noSubscribe, c?.snapshot ?? zero)
  useSyncExternalStore(session?.reader.subscribe ?? noSubscribe, session?.reader.snapshot ?? zero)
  useSyncExternalStore(
    session?.preferences.subscribe ?? noSubscribe,
    session?.preferences.snapshot ?? zero,
  )
  useSyncExternalStore(session?.tags.subscribe ?? noSubscribe, session?.tags.snapshot ?? zero)
  useSyncExternalStore(session?.civitai.subscribe ?? noSubscribe, session?.civitai.snapshot ?? zero)
  const visitKey = useRouterState({
    select: (state) => state.location.state.__TSR_key ?? "initial",
  })
  const browsing = useMemo(() => {
    const key = `tag:${tagId}`
    const saved = session?.browsing.get(key) ?? ({} as EntityBrowsingState)
    session?.browsing.set(key, saved)
    return saved
  }, [session, tagId])
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
    shouldBlockFn: ({ current, next }) =>
      !!(
        c &&
        s &&
        (next.pathname !== current.pathname ||
          ("mode" in next.search &&
            next.search.mode === "inspect" &&
            !("mode" in current.search && current.search.mode === "inspect"))) &&
        (c.dirty(s) || c.unresolved(s))
      ),
  })
  if (!session || !c || !s) return null
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
      <TagDetailPage
        coordinator={c}
        state={s}
        inspecting={destination.mode === "inspect"}
        onReturn={returning}
        entities={
          <div className="flex h-full min-h-0 flex-col">
            {(s.queryError || (s.sequence && s.scope !== s.requestedScope)) && (
              <Alert variant={s.queryError ? "destructive" : "default"}>
                <AlertDescription>
                  {s.queryError}
                  {s.sequence &&
                    ` Showing the previous ${s.scope ? "inclusive" : "direct"} result.`}
                </AlertDescription>
              </Alert>
            )}
            <div className="min-h-0 flex-1">
              <EntityPage
                source={session.source()}
                collections={[]}
                destination={destination}
                visitKey={visitKey}
                browsing={browsing}
                navigate={(search, replace) => {
                  if (search.collectionId === "library")
                    void navigate({ to: "/entity", search, replace })
                  else void navigate({ search, replace })
                }}
                onSourceReturn={returning}
                context={{
                  id: `tag:${tagId}`,
                  title: "Associated content",
                  controls,
                  sequence: s.sequence,
                  pending: s.queryPending,
                  error: s.queryError,
                  refresh: () => c.query(s),
                }}
                live={{
                  reader: session.reader,
                  filter: session.filter,
                  tags: session.tags,
                  mainDestination: session.mainDestination,
                  preferences: session.preferences,
                  api: session.api,
                  playback: session.playback,
                  civitai: session.civitai,
                  relatedCollections: session.relatedCollections,
                  civitaiExcursions: session.civitaiExcursions,
                }}
              />
            </div>
          </div>
        }
      />
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

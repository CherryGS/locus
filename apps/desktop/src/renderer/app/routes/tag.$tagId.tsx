import { createFileRoute, useBlocker } from "@tanstack/react-router"
import { useCallback, useEffect, useSyncExternalStore } from "react"
import { emptySequence } from "@/entities/entity"
import { TagDetailPage, TagGallery } from "@/pages/tag-detail"
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
  validateSearch: () => ({}),
  component: TagRoute,
})
const noSubscribe = () => () => {},
  zero = () => 0
function TagRoute() {
  const session = useLibrarySession(),
    { tagId } = Route.useParams(),
    navigate = Route.useNavigate()
  const c = session?.tagDetails,
    s = c?.state(tagId)
  useSyncExternalStore(c?.subscribe ?? noSubscribe, c?.snapshot ?? zero)
  useSyncExternalStore(session?.reader.subscribe ?? noSubscribe, session?.reader.snapshot ?? zero)
  const get = useCallback((id: string) => session!.reader.get(id), [session])
  const demand = useCallback((ids: string[]) => session?.reader.demand(ids), [session])
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
      !!(c && s && next.pathname !== current.pathname && (c.dirty(s) || c.unresolved(s))),
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
        onReturn={returning}
        entities={
          <TagGallery
            source={{ sequence: s.sequence ?? emptySequence, get, demand }}
            selectedId={s.galleryId}
            onSelect={(id) => c.selectEntity(s, id)}
            controls={controls}
            pending={s.queryPending}
            established={!!s.sequence}
            error={s.queryError}
            retained={
              s.sequence && (s.queryError || s.scope !== s.requestedScope)
                ? `Showing the previous ${s.scope ? "inclusive" : "direct"} result.`
                : undefined
            }
            refresh={() => void c.query(s)}
            reread={(id) => void session.reader.reread(id)}
            originalUrl={(id) => session.api.originalUrl(id)}
          />
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

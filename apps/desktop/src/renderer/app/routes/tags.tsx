import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useSyncExternalStore } from "react"
import { TagsPage } from "@/pages/tags"
import { useLibrarySession } from "../providers/library-provider"

export const Route = createFileRoute("/tags")({
  validateSearch: (search: Record<string, unknown>): { tag?: string } => ({
    tag: typeof search.tag === "string" ? search.tag : undefined,
  }),
  component: TagsRoute,
})
const noSubscribe = () => () => {},
  zero = () => 0
function TagsRoute() {
  const session = useLibrarySession(),
    navigate = Route.useNavigate(),
    search = Route.useSearch()
  const revision = useSyncExternalStore(
    session?.tags.subscribe ?? noSubscribe,
    session?.tags.snapshot ?? zero,
  )
  useEffect(() => {
    if (!session) return
    if (
      search.tag &&
      session.tags.attempts.some(
        (a) =>
          a.state === "confirmed" && a.change.operation === "delete" && a.change.id === search.tag,
      )
    ) {
      session.tagBrowsing.select(undefined)
      void navigate({ search: {}, replace: true })
      return
    }
    if (search.tag) session.tagBrowsing.select(search.tag)
  }, [session, search.tag, revision, navigate])
  useEffect(() => {
    if (!session) return
    void session.tags.read()
    return () => session.tagBrowsing.suspend()
  }, [session])
  if (!session) return null
  return (
    <TagsPage
      tags={session.tags}
      browsing={session.tagBrowsing}
      filter={session.filter}
      onSelect={(tag) => {
        session.tagBrowsing.locate(tag)
        void navigate({ search: { tag }, replace: true })
      }}
      onContent={() =>
        void navigate({ to: "/entity", search: { mode: "grid", collectionId: "library" } })
      }
      onActivate={(tagId) => void navigate({ to: "/tag/$tagId", params: { tagId },
        search: {} })}
    />
  )
}

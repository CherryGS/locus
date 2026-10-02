import { createFileRoute, useRouterState } from "@tanstack/react-router"
import { useEffect, useSyncExternalStore } from "react"
import {
  EntityPage,
  entitySearch,
  type EntityDestination,
} from "@/pages/entity"
import { TagsPage } from "@/pages/tags"
import { useLibrarySession } from "../providers/library-provider"

export const Route = createFileRoute("/tags")({
  validateSearch: (
    search: Record<string, unknown>,
  ): EntityDestination & { tag?: string } => ({
    ...entitySearch(search),
    tag: typeof search.tag === "string" ? search.tag : undefined,
  }),
  component: TagsRoute,
})
const noSubscribe = () => () => {},
  zero = () => 0
function TagsRoute() {
  const session = useLibrarySession()
  const navigate = Route.useNavigate()
  const search = Route.useSearch()
  const visitKey = useRouterState({
    select: (state) => state.location.state.__TSR_key ?? "initial",
  })
  useSyncExternalStore(
    session?.tagBrowsing.subscribe ?? noSubscribe,
    session?.tagBrowsing.snapshot ?? zero,
  )
  useSyncExternalStore(
    session?.tags.subscribe ?? noSubscribe,
    session?.tags.snapshot ?? zero,
  )
  useSyncExternalStore(
    session?.reader.subscribe ?? noSubscribe,
    session?.reader.snapshot ?? zero,
  )
  useSyncExternalStore(
    session?.preferences.subscribe ?? noSubscribe,
    session?.preferences.snapshot ?? zero,
  )
  useSyncExternalStore(
    session?.civitai.subscribe ?? noSubscribe,
    session?.civitai.snapshot ?? zero,
  )
  useEffect(() => {
    if (!session) return
    if (!search.tag && session.tagBrowsing.resumeId) {
      const previous = session.tagDestination
      void navigate({
        search: {
          ...previous,
          tag: session.tagBrowsing.resumeId,
          mode: "grid",
          collectionId: `tag:${session.tagBrowsing.resumeId}`,
          source: undefined,
        },
        replace: true,
      })
      return
    }
    if (session.tagBrowsing.tagId !== search.tag) session.tagBrowsingState = {}
    session.tagBrowsing.select(search.tag)
    if (
      !search.tag ||
      session.tagBrowsing.sequence ||
      session.tagBrowsing.missing
    )
      void session.tags.read()
    return () => session.tagBrowsing.suspend()
  }, [session, search.tag, navigate])
  if (!session) return null
  const browsing = session.tagBrowsing
  const id = search.tag
  const contextId = `tag:${id}`
  const destination: EntityDestination = {
    ...search,
    collectionId:
      search.collectionId === "library" ? contextId : search.collectionId,
  }
  if (id && destination.collectionId === contextId)
    session.tagDestination = { ...destination, mode: "grid", source: undefined }
  const tag = session.tags.vocabulary?.find((tag) => tag.id === id)
  const context = {
    id: contextId,
    title: tag?.name ?? "Tagged content",
    sequence: browsing.tagId === id ? browsing.sequence : undefined,
    pending: browsing.tagId !== id || browsing.pending,
    error: browsing.missing
      ? "This tag no longer exists. Choose another tag to continue browsing."
      : browsing.error,
    refresh: () => browsing.refresh(),
  }
  return (
    <TagsPage
      tags={session.tags}
      browsing={browsing}
      tagId={id}
      inspecting={destination.mode === "inspect"}
      onSelect={(tagId) => {
        if (tagId !== id) session.tagBrowsingState = {}
        void navigate({
          search: { tag: tagId, mode: "grid", collectionId: `tag:${tagId}` },
        })
      }}
      content={
        <EntityPage
          source={session.source()}
          context={context}
          collections={[]}
          destination={destination}
          visitKey={visitKey}
          browsing={session.tagBrowsingState}
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
          navigate={(next, replace) => {
            if (
              destination.mode === "inspect" &&
              next.mode === "grid" &&
              next.collectionId === contextId &&
              next.entityId
            )
              session.tagBrowsingState.grid = undefined
            if (
              next.direct ||
              next.restoreMain ||
              next.collectionId === "library"
            ) {
              void navigate({ to: "/entity", search: next, replace })
            } else void navigate({ search: { ...next, tag: id }, replace })
          }}
        />
      }
    />
  )
}

import { createFileRoute, useRouterState } from "@tanstack/react-router"
import { EntityPage, entitySearch, type EntityBrowsingState } from "@/pages/entity"
import { useMemo, useRef, useSyncExternalStore } from "react"
import { suppliedSequence, type EntityItem } from "@/entities/entity"
import { useLibrarySession, specimenMode } from "../providers/library-provider"

export const Route = createFileRoute("/entity")({
  validateSearch: entitySearch,
  loader: async () =>
    import.meta.env.DEV && specimenMode
      ? await import("../preview/entities")
      : { previewEntities: [], previewCollections: [] },
  component: EntityRoute,
})

function EntityRoute() {
  const session = useLibrarySession()
  useSyncExternalStore(session?.reader.subscribe ?? noSubscribe, session?.reader.snapshot ?? zero)
  useSyncExternalStore(session?.filter.subscribe ?? noSubscribe, session?.filter.snapshot ?? zero)
  useSyncExternalStore(session?.preferences.subscribe ?? noSubscribe, session?.preferences.snapshot ?? zero)
  useSyncExternalStore(session?.civitai.subscribe ?? noSubscribe, session?.civitai.snapshot ?? zero)
  const data = Route.useLoaderData()
  const previewSource = useMemo(
    () => ({
      sequence: suppliedSequence(data.previewEntities.map((entity) => entity.id)),
      get: (id: string): EntityItem =>
        data.previewEntities.find((entity) => entity.id === id) ?? { id, components: [] },
      demand: () => {},
    }),
    [data],
  )
  const navigate = Route.useNavigate()
  const destination = Route.useSearch()
  const historyIndex = useRouterState({ select: (state) => state.location.state.__TSR_index })
  const previousBrowsing = useRef<EntityBrowsingState | undefined>(undefined)
  const browsing = useMemo(() => {
    const key = String(historyIndex)
    const state = session?.browsing.get(key) ?? {
      grid:
        destination.restoreMain && destination.returnVisit
          ? session?.browsing.get(destination.returnVisit)?.grid
          : undefined,
      panel: previousBrowsing.current?.panel,
      panelWidth: previousBrowsing.current?.panelWidth,
    }
    session?.browsing.set(key, state)
    previousBrowsing.current = state
    return state
  }, [session, historyIndex])
  if (session && destination.collectionId === "library" && destination.mode === "grid") {
    session.mainDestination = { ...destination, returnVisit: String(historyIndex) }
  }
  const key = useRouterState({ select: (state) => state.location.state.__TSR_key ?? "initial" })
  return (
    <EntityPage
      source={session?.source() ?? previewSource}
      live={
        session
          ? {
              reader: session.reader,
              filter: session.filter,
              mainDestination: session.mainDestination,
              preferences: session.preferences,
              api: session.api,
              playback: session.playback,
              civitai: session.civitai,
              relatedCollections: session.relatedCollections,
              civitaiExcursions: session.civitaiExcursions,
            }
          : undefined
      }
      collections={data.previewCollections}
      destination={destination}
      visitKey={key}
      browsing={browsing}
      navigate={(search, replace) => {
        void navigate({ search, replace })
      }}
    />
  )
}

const noSubscribe = () => () => {}
const zero = () => 0

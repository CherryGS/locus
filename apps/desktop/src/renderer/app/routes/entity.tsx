import { createFileRoute, useRouterState } from "@tanstack/react-router"
import { EntityPage, entitySearch } from "@/pages/entity"
import { useMemo, useSyncExternalStore } from "react"
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
  useSyncExternalStore(session?.preferences.subscribe ?? noSubscribe, session?.preferences.snapshot ?? zero)
  const data = Route.useLoaderData()
  const previewSource = useMemo(
    () => ({
      sequence: suppliedSequence(data.previewEntities.map((entity) => entity.id)),
      get: (id: string): EntityItem =>
        data.previewEntities.find((entity) => entity.id === id) ?? { id, components: [] },
      demand: () => {},
    }),
    [data]
  )
  const navigate = Route.useNavigate()
  const key = useRouterState({ select: (state) => state.location.state.__TSR_key ?? "initial" })
  return (
    <EntityPage
      source={session?.source() ?? previewSource}
      live={session ? { reader: session.reader, preferences: session.preferences, api: session.api } : undefined}
      collections={data.previewCollections}
      destination={Route.useSearch()}
      visitKey={key}
      navigate={(search, replace) => {
        void navigate({ search, replace })
      }}
    />
  )
}

const noSubscribe = () => () => {}
const zero = () => 0

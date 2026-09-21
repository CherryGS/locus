import { createFileRoute, useRouterState } from "@tanstack/react-router"
import { EntityPage, entitySearch } from "@/pages/entity"

export const Route = createFileRoute("/entity")({
  validateSearch: entitySearch,
  loader: async () =>
    import.meta.env.DEV
      ? await import("../preview/entities")
      : { previewEntities: [], previewCollections: [] },
  component: EntityRoute,
})

function EntityRoute() {
  const data = Route.useLoaderData()
  const navigate = Route.useNavigate()
  const key = useRouterState({ select: (state) => state.location.state.__TSR_key ?? "initial" })
  return (
    <EntityPage
      entities={data.previewEntities}
      collections={data.previewCollections}
      destination={Route.useSearch()}
      visitKey={key}
      navigate={(search, replace) => {
        void navigate({ search, replace })
      }}
    />
  )
}

import { createFileRoute } from "@tanstack/react-router"
import { EntityPage } from "@/pages/entity"
import type { EntityItem } from "@/entities/entity"

export const Route = createFileRoute("/entity")({
  loader: async (): Promise<readonly EntityItem[]> => import.meta.env.DEV
    ? (await import("../preview/entities")).previewEntities
    : [],
  component: EntityRoute,
})

function EntityRoute() {
  return <EntityPage entities={Route.useLoaderData()} />
}

import type { EntityItem } from "@/entities/entity"
import { useEntitySelection } from "@/features/entity-selection"
import { Empty, EmptyDescription, EmptyHeader } from "@/shared/ui/empty"
import { EntityGrid } from "./entity-grid"

export function EntityPage({ entities }: { entities: readonly EntityItem[] }) {
  const { selectedEntity, selectEntity } = useEntitySelection()
  return (
    <section className="flex h-full min-h-0 flex-col gap-5" aria-labelledby="entity-heading">
      <h1 id="entity-heading" className="text-xl font-semibold tracking-tight">Entity</h1>
      {entities.length > 0
        ? <EntityGrid entities={entities} selectedId={selectedEntity?.id} onSelect={selectEntity} />
        : <Empty><EmptyHeader><EmptyDescription>No entities yet.</EmptyDescription></EmptyHeader></Empty>}
    </section>
  )
}

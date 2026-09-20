import type { EntityItem } from "@/entities/entity"
import { EntitySelectionProvider } from "@/features/entity-selection"
import { Separator } from "@/shared/ui/separator"
import { EntityWorkspace } from "./entity-workspace"

export function EntityPage({ entities }: { entities: readonly EntityItem[] }) {
  return (
    <EntitySelectionProvider>
      <section className="flex h-full min-h-0 flex-col" aria-labelledby="entity-heading">
        <header data-slot="entity-page-header" className="flex h-16 shrink-0 items-center gap-4 px-6">
          <h1 id="entity-heading" className="text-xl font-semibold tracking-tight">Entity</h1>
        </header>
        <Separator />
        <EntityWorkspace entities={entities} />
      </section>
    </EntitySelectionProvider>
  )
}

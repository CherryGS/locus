import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import type { EntityItem } from "@/entities/entity"

type EntitySelection = {
  selectedEntity: EntityItem | null
  selectEntity: (entity: EntityItem | null) => void
}

const EntitySelectionContext = createContext<EntitySelection | null>(null)

export function EntitySelectionProvider({ children }: { children: ReactNode }) {
  const [selectedEntity, selectEntity] = useState<EntityItem | null>(null)
  const selection = useMemo(() => ({ selectedEntity, selectEntity }), [selectedEntity])
  return <EntitySelectionContext value={selection}>{children}</EntitySelectionContext>
}

export function useEntitySelection() {
  const selection = useContext(EntitySelectionContext)
  if (!selection) throw new Error("Entity selection requires EntitySelectionProvider")
  return selection
}

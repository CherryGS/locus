import { PanelRightIcon, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { componentAppearance, EntityComponentDetails, EntityOverview, type EntityComponent, type EntityItem } from "@/entities/entity"

export type EntityPanelId = "overview" | EntityComponent["kind"]

type EntityPanel = {
  id: EntityPanelId
  label: string
  identity?: { label: string; value: string }
  icon: LucideIcon
  content: ReactNode
}

export function entityPanels(entity: EntityItem | null, viewSelection?: ReactNode): EntityPanel[] {
  return [
    {
      id: "overview", label: "Overview", icon: PanelRightIcon,
      identity: entity ? { label: "Entity ID", value: entity.id } : undefined,
      content: <EntityOverview entity={entity} viewSelection={viewSelection} />,
    },
    ...(entity?.components.map((component) => ({
      id: component.kind,
      label: componentAppearance[component.kind].label,
      identity: { label: "Component ID", value: component.id },
      icon: componentAppearance[component.kind].icon,
      content: <EntityComponentDetails component={component} />,
    })) ?? []),
  ]
}

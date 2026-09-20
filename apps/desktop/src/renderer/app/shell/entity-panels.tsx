import { FileIcon, ImageIcon, PanelRightIcon, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { EntityComponentDetails, EntityOverview, type EntityComponent, type EntityItem } from "@/entities/entity"

export type EntityPanelId = "overview" | EntityComponent["kind"]

type EntityPanel = { id: EntityPanelId; label: string; icon: LucideIcon; content: ReactNode }

export function entityPanels(entity: EntityItem | null): EntityPanel[] {
  return [
    { id: "overview", label: "Overview", icon: PanelRightIcon, content: <EntityOverview entity={entity} /> },
    ...(entity?.components.map((component) => ({
      id: component.kind,
      label: component.kind === "file" ? "File" : "Image",
      icon: component.kind === "file" ? FileIcon : ImageIcon,
      content: <EntityComponentDetails component={component} />,
    })) ?? []),
  ]
}

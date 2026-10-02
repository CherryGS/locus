import type { GridPosition } from "@/entities/entity"

export type EntityBrowsingState = {
  grid?: GridPosition
  panel?: string | null
  panelWidth?: number
  override?: { entityId: string; viewId: string } | null
  explanation?: string
}

import type { IdentitySequence } from "@/entities/entity"

export type GridPosition = { anchor?: string; offset: number; logical: number }
export type EntityBrowsingState = {
  grid?: GridPosition
  panel?: string | null
  panelWidth?: number
  override?: { entityId: string; viewId: string } | null
  explanation?: string
}

// Resolve the anchor against the current sequence and measured columns. A lost
// anchor only clamps the viewport; it never chooses a replacement Entity.
export function restoreGridPosition(
  position: GridPosition,
  sequence: IdentitySequence,
  columns: number,
  stride: number,
) {
  const index = position.anchor ? sequence.indexOf(position.anchor) : -1
  return index >= 0 ? Math.floor(index / columns) * stride + position.offset : position.logical
}

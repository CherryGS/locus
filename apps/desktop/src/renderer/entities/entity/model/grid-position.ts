import type { IdentitySequence } from "./identity-sequence"

export type GridPosition = { anchor?: string; offset: number; logical: number }

// A lost anchor clamps the viewport without choosing a replacement Entity.
export function restoreGridPosition(position: GridPosition, sequence: IdentitySequence, columns: number, stride: number) {
  const index = position.anchor ? sequence.indexOf(position.anchor) : -1
  return index >= 0 ? Math.floor(index / columns) * stride + position.offset : position.logical
}

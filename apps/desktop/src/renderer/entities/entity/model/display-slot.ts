import type { EntityItem } from "./entity-item"

export type DisplayCandidate<Value> = (entity: EntityItem) => Value | undefined

export function resolveDisplaySlot<Value>(entity: EntityItem, candidates: readonly DisplayCandidate<Value>[]): Value | undefined {
  for (const candidate of candidates) {
    const value = candidate(entity)
    if (value !== undefined) return value
  }
  return undefined
}

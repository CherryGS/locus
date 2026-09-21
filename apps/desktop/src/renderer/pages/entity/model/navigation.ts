import type { EntityItem } from "@/entities/entity"

export type EntityDestination = {
  entityId?: string
  mode: "grid" | "inspect"
  collectionId: string
  source?: EntityDestination & { viewId?: string }
}
export type RelatedCollection = {
  id: string
  name: string
  ownerId: string
  viewId: string
  entityIds: readonly string[]
}

export function entitySearch(search: Record<string, unknown>): EntityDestination {
  return {
    entityId: typeof search.entityId === "string" ? search.entityId : undefined,
    mode: search.mode === "inspect" ? "inspect" : "grid",
    collectionId: typeof search.collectionId === "string" ? search.collectionId : "library",
    source:
      search.source && typeof search.source === "object"
        ? {
            ...entitySearch(search.source as Record<string, unknown>),
            viewId:
              typeof (search.source as Record<string, unknown>).viewId === "string"
                ? (search.source as { viewId: string }).viewId
                : undefined,
          }
        : undefined,
  }
}
export function inspectionDestination(current: EntityDestination, entityId: string): EntityDestination {
  return {
    ...current,
    entityId,
    mode: "inspect",
    source: current.mode === "grid" ? { ...current, source: undefined } : current.source,
  }
}
export function exitDestination(current: EntityDestination): EntityDestination {
  const source = current.source ?? { mode: "grid", collectionId: "library" }
  return source.mode === "grid" ? { ...source, entityId: current.entityId } : source
}
export function relatedDestination(
  current: EntityDestination,
  collection: RelatedCollection,
  entityId: string
): EntityDestination {
  return {
    entityId,
    mode: "inspect",
    collectionId: collection.id,
    source: { ...current, viewId: collection.viewId },
  }
}
export function adjacentEntity(entities: readonly EntityItem[], currentId: string, direction: -1 | 1) {
  if (entities.length < 2) return undefined
  const index = entities.findIndex((entity) => entity.id === currentId)
  return entities[(index + direction + entities.length) % entities.length]
}
export function nearbyEntities(entities: readonly EntityItem[], currentId: string, capacity: number) {
  const current = entities.findIndex((entity) => entity.id === currentId)
  if (current < 0) return []
  const count = Math.max(0, Math.min(entities.length, capacity))
  const before = Math.floor((count - 1) / 2)
  return Array.from({ length: count }, (_, index) => {
    const offset = index - before
    return { entity: entities[(current + offset + entities.length) % entities.length], offset }
  })
}

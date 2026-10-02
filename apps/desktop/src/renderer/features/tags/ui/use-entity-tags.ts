import { useEffect, useSyncExternalStore } from "react"
import type { EntityItem } from "@/entities/entity"
import type { TagCoordinator } from "../model/tag-coordinator"
import { entityTagObservation } from "../model/entity-tag-observation"

export function useEntityTags(entity: EntityItem, coordinator: TagCoordinator) {
  useSyncExternalStore(coordinator.subscribe, coordinator.snapshot)
  useEffect(() => {
    if (!coordinator.vocabulary && !coordinator.loading) void coordinator.read()
  }, [coordinator])
  return {
    ...entityTagObservation(entity),
    attempts: coordinator.attempts.filter((attempt) => "entity_id" in attempt.change && attempt.change.entity_id === entity.id),
  }
}

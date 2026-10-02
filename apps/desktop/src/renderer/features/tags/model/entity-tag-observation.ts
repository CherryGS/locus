import type { EntityItem } from "@/entities/entity"
import type { TagAttempt } from "./tag-coordinator"

export function entityTagObservation(entity: EntityItem) {
  const set = entity.components.find((component) => component.kind === "tag")
  return {
    set,
    tags: set?.record?.tags ?? [],
    waiting: entity.membershipsStatus === "loading" || entity.membershipsStatus === "unread" || set?.readStatus === "loading" ||
      !!(set && !set.record && set.readStatus !== "failed"),
    failed: entity.membershipsStatus === "failed" || entity.membershipsStatus === "missing" || set?.readStatus === "failed" ||
      !!entity.problems?.some((problem) => problem.key === "tags:read"),
  }
}

export function tagPairBusy(attempts: readonly TagAttempt[], entityId: string, tagId: string) {
  return attempts.some((attempt) => "entity_id" in attempt.change && attempt.change.entity_id === entityId &&
    attempt.change.tag_id === tagId && (attempt.state === "pending" || attempt.state === "unconfirmed" || attempt.observing))
}

export function latestAssignmentAttempts(attempts: readonly TagAttempt[]) {
  const latest = new Map<string, TagAttempt>()
  for (const attempt of attempts) {
    if ("entity_id" in attempt.change)
      latest.set(`${attempt.change.entity_id}:${attempt.change.tag_id}`, attempt)
  }
  return [...latest.values()]
}

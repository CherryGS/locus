import type { ReactNode } from "react"
import type { ImportCoordinator } from "@/features/file-import"
import type { TaskObserver } from "@/entities/task"
import { outcomeSummary, needsAttention, type FeedbackRecord } from "@/features/task-feedback"
export function taskRecords(
  c: ImportCoordinator,
  observer: TaskObserver,
  details: (id: string) => ReactNode,
): FeedbackRecord[] {
  const records = new Map<string, FeedbackRecord>()
  function batch(id: string) {
    let record = records.get(id)
    if (!record) {
      record = {
        id,
        label: "Import content",
        summary: "Details unavailable",
        active: false,
        attention: false,
        attempts: [],
        details: details(id),
      }
      records.set(id, record)
    }
    return record
  }
  for (const observation of observer.records.values()) {
    const operation = observation.task.operation
    if (operation.kind === "import_batch" || operation.kind === "import_recovery") {
      const record = batch(operation.batch_id)
      record.attempts.push(observation)
      record.active ||= observation.task.state !== "terminal"
      record.attention ||= needsAttention(observation)
      if (operation.kind === "import_batch")
        record.label = `Import ${operation.item_count} ${operation.item_count === 1 ? "item" : "items"}`
    } else {
      records.set(observation.task.task_id, {
        id: observation.task.task_id,
        label:
          operation.kind === "file_import"
            ? `Import file - ${operation.source_path.split(/[\\/]/).pop()}`
            : `${operation.target.kind} ${operation.kind}`,
        summary: outcomeSummary(observation),
        active: observation.task.state !== "terminal",
        attention: needsAttention(observation),
        attempts: [observation],
      })
    }
  }
  for (const value of c.batches) {
    const record = batch(value.batch_id)
    record.label = value.items.some((item) => item.supplied)
      ? `Import ${value.items.length} ${value.items.length === 1 ? "item" : "items"}`
      : `Import ${value.items.length} ${value.items.length === 1 ? "file" : "files"}`
    const ended = new Set(
      record.attempts.filter((a) => a.task.state === "terminal").map((a) => a.task.request_id),
    )
    const active = value.items.filter(
      (item) => item.active_request_id && !ended.has(item.active_request_id),
    ).length
    record.active ||= active > 0 || (!value.original_ended && !ended.has(value.batch_id))
    const complete = value.items.filter((item) => !item.active_request_id && item.current.complete).length
    const attention = value.items.filter((item) => !item.active_request_id && !item.current.complete).length
    const stale = value.items.some((item) => item.active_request_id && ended.has(item.active_request_id))
    record.attention = attention > 0 || !!c.problem || record.attempts.some((attempt) => !!attempt.problem)
    record.summary = `${complete} complete - ${attention} need attention${active ? ` - ${active} processing` : ""}${c.problem || stale ? " - last known details" : ""}`
  }
  for (const submission of c.submissions.values()) {
    const record = batch(
      "source_paths" in submission.body ? submission.body.request_id : submission.body.batch_id,
    )
    const known = record.attempts.find((attempt) => attempt.task.request_id === submission.body.request_id)
    record.active ||= !known && (submission.pending || !!submission.accepted)
    record.attention ||= !!submission.problem || (!submission.pending && !submission.accepted)
    record.summary =
      known?.task.state === "terminal"
        ? "Execution ended - details unconfirmed"
        : submission.pending
          ? "Establishing admission"
          : submission.accepted
            ? "Accepted - awaiting details"
            : "Submission unconfirmed"
  }
  return [...records.values()]
}

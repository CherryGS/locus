import type { ReactNode } from "react"
import type { ImportCoordinator } from "@/features/file-import"
import type { TaskObserver } from "@/entities/task"
import { outcomeSummary, needsAttention, type FeedbackRecord } from "@/features/task-feedback"
export function taskRecords(
  c: ImportCoordinator,
  observer: TaskObserver,
  details: (id: string, pendingRequestId?: string) => ReactNode,
): FeedbackRecord[] {
  const records = new Map<string, FeedbackRecord>()
  function batch(id: string, pendingRequestId?: string) {
    let record = records.get(id)
    if (!record) {
      record = {
        id,
        label: "Import content",
        summary: "Details unavailable",
        active: false,
        attention: false,
        attempts: [],
        details: details(id, pendingRequestId),
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
    } else if (operation.kind === "upload" || operation.kind === "upload_recovery") {
      const id = `upload:${operation.upload_id}`
      const previous = records.get(id)
      records.set(id, {
        id,
        label:
          operation.kind === "upload"
            ? `Upload ${operation.filename ?? "file"}`
            : (previous?.label ?? "Uploaded File"),
        summary: outcomeSummary(observation),
        active: (previous?.active ?? false) || observation.task.state !== "terminal",
        attention: needsAttention(observation),
        attempts: [...(previous?.attempts ?? []), observation],
      })
    } else {
      records.set(observation.task.task_id, {
        id: observation.task.task_id,
        label:
          operation.kind === "file_import"
            ? `Import file - ${operation.source_path.split(/[\\/]/).pop()}`
            : operation.kind === "civitai"
              ? `Civitai · origin ${operation.entity_id.slice(-8)}`
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
    record.active ||= active > 0 || (!value.original_ended && !ended.has(value.original_request_id))
    const complete = value.items.filter((item) => !item.active_request_id && item.current.complete).length
    const attention = value.items.filter((item) => !item.active_request_id && !item.current.complete).length
    const stale = value.items.some((item) => item.active_request_id && ended.has(item.active_request_id))
    record.attention = attention > 0 || !!c.problem || record.attempts.some((attempt) => !!attempt.problem)
    record.summary = `${complete} complete - ${attention} need attention${active ? ` - ${active} processing` : ""}${c.problem || stale ? " - last known details" : ""}`
  }
  for (const submission of c.submissions.values()) {
    const observed = [...observer.records.values()].find(
      (a) => a.task.access_context === "desktop" && a.task.request_id === submission.body.request_id,
    )
    const original = c.batches.find(
      (b) => b.access_context === "desktop" && b.original_request_id === submission.body.request_id,
    )
    const record = batch(
      "source_paths" in submission.body
        ? (original?.batch_id ??
            (observed?.task.operation.kind === "import_batch"
              ? observed.task.operation.batch_id
              : `pending:${submission.body.request_id}`))
        : submission.body.batch_id,
      "source_paths" in submission.body ? submission.body.request_id : undefined,
    )
    const known = record.attempts.find(
      (attempt) =>
        attempt.task.access_context === "desktop" && attempt.task.request_id === submission.body.request_id,
    )
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

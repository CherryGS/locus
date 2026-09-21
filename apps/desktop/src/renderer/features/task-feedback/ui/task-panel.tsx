import type { ReactNode } from "react"
import { XIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/shared/ui/dialog"
import { diagnosticText, commitUnknown } from "@/shared/api"
import type { TaskObservation } from "@/entities/task"

export type FeedbackRecord = {
  id: string
  label: string
  summary: string
  active: boolean
  attention: boolean
  attempts: TaskObservation[]
  details?: ReactNode
}
export function outcomeSummary(record: TaskObservation): string {
  const value = record.outcome
  if (!value)
    return record.task.state === "terminal"
      ? "Execution ended · outcome unavailable"
      : record.task.state.replaceAll("_", " ")
  switch (value.status) {
    case "import_batch":
      return "Original execution ended"
    case "import_recovery":
      return "Recovery execution ended"
    case "imported":
      return `File admitted · ${value.file.byte_count} bytes`
    case "failed": {
      const progress = value.progress
      const copy = progress
        ? ` · ${progress.bytes_written} copied bytes · copy ${progress.copy_complete ? "complete" : "incomplete"}${progress.managed_bytes_may_exist ? " · managed bytes may remain" : ""}`
        : ""
      return `${value.diagnostic.kind === "commit_outcome_unknown" ? "Commit outcome unconfirmed · " : ""}${value.diagnostic.message}${copy}`
    }
    case "media_failed":
      return `${commitUnknown(value.diagnostic) ? "Commit outcome unconfirmed · " : ""}${diagnosticText(value.diagnostic)}`
    case "preview":
      return `${value.preview.kind} preview ${value.preview.origin} · ${value.preview.edge}px`
    case "interpreted":
      return value.result.status === "accepted"
        ? value.result.record.last_failure
          ? `Interpretation accepted with warning: ${value.result.record.last_failure.detail}`
          : "Interpretation accepted"
        : value.result.status === "rejected_context_changed"
          ? "Interpretation rejected: context changed"
          : "Interpretation rejected: newer attempt"
  }
}
export function needsAttention(record: TaskObservation) {
  const value = record.outcome
  return (
    !!record.problem ||
    (record.task.state === "terminal" &&
      (!value ||
        value.status === "failed" ||
        value.status === "media_failed" ||
        (value.status === "interpreted" &&
          (value.result.status !== "accepted" || !!value.result.record.last_failure))))
  )
}
export function TaskPanel({
  records,
  problem,
  established,
  finalFocus,
  reread,
  retryOutcome,
}: {
  records: FeedbackRecord[]
  problem?: string
  established: boolean
  finalFocus: () => HTMLElement | false | null
  reread: () => void
  retryOutcome: (id: string) => void
}) {
  return (
    <DialogContent
      keepMounted
      showCloseButton={false}
      finalFocus={finalFocus}
      className="flex h-[min(85dvh,48rem)] min-h-0 flex-col overflow-hidden sm:max-w-4xl"
    >
      <div className="flex shrink-0 items-start justify-between gap-3">
        <DialogHeader>
          <DialogTitle>Tasks this run</DialogTitle>
          <DialogDescription>Current operations and their original and recovery results.</DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={reread}>
            Check task observation
          </Button>
          <DialogClose render={<Button size="icon-sm" variant="ghost" aria-label="Close tasks" />}>
            <XIcon />
          </DialogClose>
        </div>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 pr-3">
          {problem && (
            <Alert>
              <AlertTitle>Task feedback needs attention</AlertTitle>
              <AlertDescription className="whitespace-pre-line">{problem}</AlertDescription>
            </Alert>
          )}
          {!records.length && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>{established ? "No tasks this run" : "Waiting for task observation"}</EmptyTitle>
                <EmptyDescription>
                  Choose Import to select local files. Canceling selection submits nothing.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {records.map((record) => (
            <details key={record.id} className="rounded-lg border p-3" data-task-record={record.id}>
              <summary className="cursor-pointer text-sm">
                <span className="font-medium">{record.label}</span>
                {" · "}
                {record.summary} {record.active && <Badge variant="secondary">Active</Badge>}{" "}
                {record.attention && <Badge variant="outline">Needs attention</Badge>}
              </summary>
              <div className="mt-3 flex flex-col gap-4">
                {record.details}
                {record.attempts.map((attempt) => (
                  <details key={attempt.task.task_id}>
                    <summary className="cursor-pointer text-sm">
                      {attempt.task.operation.kind === "import_recovery" ? "Recovery" : "Original"}:{" "}
                      {outcomeSummary(attempt)}
                    </summary>
                    <div className="flex flex-col gap-2 py-2 text-xs">
                      <p>
                        Execution: {attempt.task.state.replaceAll("_", " ")}
                        {attempt.task.stage ? ` · stage: ${attempt.task.stage}` : ""}
                      </p>
                      {attempt.task.message && <p>{attempt.task.message}</p>}
                      {attempt.task.completed !== null && (
                        <p>
                          Current stage progress: {attempt.task.completed}
                          {attempt.task.total !== null ? ` / ${attempt.task.total}` : " · total unknown"}
                        </p>
                      )}
                      <p>{outcomeSummary(attempt)}</p>
                      {attempt.problem && <p>Outcome observation unavailable: {attempt.problem}</p>}
                      {attempt.task.state === "terminal" && !attempt.outcome && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => retryOutcome(attempt.task.task_id)}
                        >
                          Check original outcome
                        </Button>
                      )}
                      <details>
                        <summary>Identities and retained result</summary>
                        <pre className="whitespace-pre-wrap break-all">
                          {JSON.stringify({ task: attempt.task, outcome: attempt.outcome }, null, 2)}
                        </pre>
                      </details>
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))}
        </div>
      </ScrollArea>
    </DialogContent>
  )
}

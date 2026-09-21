import { useState, type ReactNode } from "react"
import {
  ChevronRightIcon,
  FileIcon,
  FilesIcon,
  HistoryIcon,
  ImageIcon,
  ListChecksIcon,
  RefreshCwIcon,
  ScanLineIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from "@/shared/ui/empty"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose } from "@/shared/ui/dialog"
import { diagnosticText, commitUnknown } from "@/shared/api"
import type { TaskObservation } from "@/entities/task"
import { Separator } from "@/shared/ui/separator"
import { Spinner } from "@/shared/ui/spinner"

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

function ExecutionDetails({
  attempt,
  retryOutcome,
}: {
  attempt: TaskObservation
  retryOutcome: (id: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-2">
        <dt className="text-muted-foreground">Execution</dt>
        <dd>{attempt.task.state.replaceAll("_", " ")}</dd>
        {attempt.task.stage && (
          <>
            <dt className="text-muted-foreground">Stage</dt>
            <dd className="break-words">{attempt.task.stage}</dd>
          </>
        )}
        {attempt.task.completed !== null && (
          <>
            <dt className="text-muted-foreground">Stage progress</dt>
            <dd className="tabular-nums">
              {attempt.task.completed}
              {attempt.task.total !== null ? ` / ${attempt.task.total}` : " · total unknown"}
            </dd>
          </>
        )}
      </dl>
      {attempt.task.message && <p className="break-words text-muted-foreground">{attempt.task.message}</p>}
      {attempt.problem && (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Outcome observation unavailable</AlertTitle>
          <AlertDescription className="break-words">{attempt.problem}</AlertDescription>
        </Alert>
      )}
      {attempt.task.state === "terminal" && !attempt.outcome && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => retryOutcome(attempt.task.task_id)}
        >
          <RefreshCwIcon data-icon="inline-start" />
          Check original outcome
        </Button>
      )}
    </div>
  )
}

function RetainedResult({ attempt }: { attempt: TaskObservation }) {
  return (
    <details className="group/result min-w-0">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 transition-transform group-open/result:rotate-90" />
        Identities and retained result
      </summary>
      <pre className="mt-3 max-w-full whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        {JSON.stringify({ task: attempt.task, outcome: attempt.outcome }, null, 2)}
      </pre>
    </details>
  )
}

function RecordDetails({
  record,
  retryOutcome,
}: {
  record: FeedbackRecord
  retryOutcome: (id: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-6 p-5 sm:p-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {record.active && (
            <Badge variant="secondary">
              <Spinner data-icon="inline-start" />
              Active
            </Badge>
          )}
          {record.attention && (
            <Badge variant="destructive">
              <TriangleAlertIcon data-icon="inline-start" />
              Needs attention
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">#{record.id.slice(-8)}</span>
        </div>
        <h2 className="text-lg font-semibold tracking-tight">{record.label}</h2>
        <p className="break-words text-sm leading-relaxed text-muted-foreground">{record.summary}</p>
      </header>
      {record.details ? (
        <>
          {record.attempts
            .filter((attempt) => attempt.task.state !== "terminal")
            .map((attempt) => (
              <ExecutionDetails key={attempt.task.task_id} attempt={attempt} retryOutcome={retryOutcome} />
            ))}
          {record.details}
          {!!record.attempts.length && (
            <>
              <Separator />
              <details className="group/history">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
                  <HistoryIcon className="size-4" />
                  Execution history
                  <span className="tabular-nums">({record.attempts.length})</span>
                  <ChevronRightIcon className="ml-auto size-4 transition-transform group-open/history:rotate-90" />
                </summary>
                <div className="mt-4 flex flex-col gap-4">
                  {record.attempts.map((attempt, index) => (
                    <details key={attempt.task.task_id} className="group/attempt">
                      <summary className="flex cursor-pointer list-none items-start gap-2 text-sm [&::-webkit-details-marker]:hidden">
                        <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open/attempt:rotate-90" />
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="font-medium">
                            {attempt.task.operation.kind === "import_recovery" ? "Recovery" : "Original"}{" "}
                            execution <span className="text-muted-foreground">· {index + 1}</span>
                          </span>
                          <span className="break-words text-xs text-muted-foreground">
                            {outcomeSummary(attempt)}
                          </span>
                        </span>
                      </summary>
                      <div className="ml-6 mt-3 flex min-w-0 flex-col gap-4">
                        <ExecutionDetails attempt={attempt} retryOutcome={retryOutcome} />
                        <RetainedResult attempt={attempt} />
                      </div>
                    </details>
                  ))}
                </div>
              </details>
            </>
          )}
        </>
      ) : (
        record.attempts.map((attempt) => (
          <div key={attempt.task.task_id} className="flex min-w-0 flex-col gap-6">
            <ExecutionDetails attempt={attempt} retryOutcome={retryOutcome} />
            <Separator />
            <RetainedResult attempt={attempt} />
          </div>
        ))
      )}
    </div>
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
  const [selection, setSelection] = useState<string>()
  const selected = records.find((record) => record.id === selection) ?? records[0]
  const active = records.filter((record) => record.active).length
  const attention = records.filter((record) => record.attention).length
  return (
    <DialogContent
      keepMounted
      showCloseButton={false}
      finalFocus={finalFocus}
      className="flex h-[min(85dvh,44rem)] min-h-0 w-[calc(100%-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-4">
        <DialogHeader className="gap-1.5">
          <DialogTitle>
            <span className="flex items-center gap-2">
              <ListChecksIcon className="size-4 text-muted-foreground" />
              Tasks this run
            </span>
          </DialogTitle>
          <DialogDescription>
            {records.length} operations{active > 0 && ` · ${active} active`}
            {attention > 0 && ` · ${attention} need attention`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Check task observation"
            title="Refresh task status"
            onClick={reread}
          >
            <RefreshCwIcon />
          </Button>
          <DialogClose render={<Button size="icon-sm" variant="ghost" aria-label="Close tasks" />}>
            <XIcon />
          </DialogClose>
        </div>
      </div>
      <Separator />
      {problem && (
        <div className="shrink-0 px-5 py-3">
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>Task feedback needs attention</AlertTitle>
            <AlertDescription className="max-h-24 overflow-auto whitespace-pre-line break-words">
              {problem}
            </AlertDescription>
          </Alert>
        </div>
      )}
      {!records.length ? (
        <Empty className="m-5 flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListChecksIcon />
            </EmptyMedia>
            <EmptyTitle>{established ? "No tasks this run" : "Waiting for task observation"}</EmptyTitle>
            <EmptyDescription>
              Choose Import to select local files. Canceling selection submits nothing.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <ScrollArea
            className="min-h-0 min-w-0 basis-2/5 sm:w-[32%] sm:shrink-0 sm:basis-auto"
            viewportProps={{ "aria-label": "Task list" }}
          >
            <nav aria-label="Tasks" className="flex flex-col gap-1 p-2">
              {records.map((record) => {
                const kind = record.attempts[0]?.task.operation.kind
                const Icon =
                  kind === "interpretation"
                    ? ScanLineIcon
                    : kind === "preview"
                      ? ImageIcon
                      : kind === "file_import"
                        ? FileIcon
                        : FilesIcon
                return (
                  <Button
                    key={record.id}
                    data-task-record={record.id}
                    variant={selected?.id === record.id ? "secondary" : "ghost"}
                    aria-current={selected?.id === record.id ? "true" : undefined}
                    aria-controls={`task-detail-${record.id}`}
                    className="h-auto w-full items-start justify-start gap-3 px-3 py-3"
                    onClick={() => setSelection(record.id)}
                  >
                    <Icon data-icon="inline-start" className="mt-0.5 text-muted-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{record.label}</span>
                        {record.active && <Spinner className="ml-auto" aria-label="Active" />}
                        {record.attention && (
                          <TriangleAlertIcon
                            className="ml-auto text-destructive"
                            aria-label="Needs attention"
                          />
                        )}
                      </span>
                      <span className="line-clamp-2 whitespace-normal break-words text-xs font-normal leading-relaxed text-muted-foreground">
                        {record.summary}
                      </span>
                      <span className="mt-0.5 text-xs font-normal text-muted-foreground">
                        #{record.id.slice(-8)}
                      </span>
                    </span>
                  </Button>
                )
              })}
            </nav>
          </ScrollArea>
          <Separator orientation="vertical" className="hidden sm:block" />
          <Separator className="sm:hidden" />
          <div className="min-h-0 min-w-0 flex-1">
            {/* Keep each operation mounted so switching tasks retains disclosure,
                scroll and pending View feedback, just like dismissing the modal. */}
            {records.map((record) => (
              <div
                key={record.id}
                id={`task-detail-${record.id}`}
                data-task-detail={record.id}
                hidden={selected?.id !== record.id}
                className="size-full min-w-0"
              >
                <ScrollArea className="size-full" viewportProps={{ "aria-label": "Task details" }}>
                  <RecordDetails record={record} retryOutcome={retryOutcome} />
                </ScrollArea>
              </div>
            ))}
          </div>
        </div>
      )}
    </DialogContent>
  )
}

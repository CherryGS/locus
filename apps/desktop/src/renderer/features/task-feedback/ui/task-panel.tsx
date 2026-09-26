import { useState, type ReactNode } from "react"
import {
  BoxIcon,
  UploadIcon,
  CheckIcon,
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
import { Input } from "@/shared/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group"

export type FeedbackRecord = {
  id: string
  label: string
  summary: string
  searchText?: string
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
    case "civitai":
      return value.result
        ? `Civitai ${value.result.state} · metadata ${value.result.metadata}${value.result.problem ? ` · ${value.result.problem}` : ""}`
        : `Civitai outcome unavailable · ${value.observation_problem ?? "Read operation details"}`
    case "upload":
      return value.result.confirmed_file_id
        ? `File registered · ${value.result.byte_count} bytes · ready for import`
        : `${value.result.uncertain ? "File registration unconfirmed · " : "File admission incomplete · "}${value.result.problem ?? "Inspect the original upload"}${value.result.managed_bytes_may_exist ? " · managed bytes retained" : ""}`
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
        (value.status === "civitai" && (!value.result || value.result.state !== "complete")) ||
        (value.status === "upload" && !value.result.confirmed_file_id) ||
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
          <h2 className="min-w-0 flex-1 break-words text-lg font-semibold tracking-tight">{record.label}</h2>
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
          {!record.active && !record.attention && (
            <Badge variant="outline">
              <CheckIcon data-icon="inline-start" />
              Finished
            </Badge>
          )}
        </div>
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
                            {["import_recovery", "upload_recovery"].includes(attempt.task.operation.kind)
                              ? "Recovery"
                              : "Original"}{" "}
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
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">
                {attempt.task.operation.kind === "upload_recovery"
                  ? "Recovery execution"
                  : "Original execution"}
              </h3>
            </div>
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
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const query = search.trim().toLocaleLowerCase()
  const filtered = records.filter(
    (record) =>
      (filter === "all" ||
        (filter === "active" && record.active) ||
        (filter === "attention" && record.attention) ||
        (filter === "finished" && !record.active && !record.attention)) &&
      (!query ||
        `${record.label} ${record.summary} ${record.id} ${record.searchText ?? ""}`
          .toLocaleLowerCase()
          .includes(query)),
  )
  const selected = filtered.find((record) => record.id === selection) ?? filtered[0]
  const active = records.filter((record) => record.active).length
  const attention = records.filter((record) => record.attention).length
  return (
    <DialogContent
      keepMounted
      showCloseButton={false}
      finalFocus={finalFocus}
      className="flex h-[90dvh] min-h-0 w-[90vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-4">
        <DialogHeader className="gap-1.5">
          <DialogTitle>
            <span className="flex items-center gap-2">
              <ListChecksIcon className="size-4 text-muted-foreground" />
              Tasks this run
            </span>
          </DialogTitle>
          <DialogDescription>Import and processing activity for this session.</DialogDescription>
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
      {!!records.length && (
        <>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-3">
            <ToggleGroup
              aria-label="Filter tasks"
              className="max-w-full flex-wrap"
              size="sm"
              variant="outline"
              value={[filter]}
              onValueChange={(values) => {
                if (values[0]) {
                  setFilter(values[0])
                  setSelection(undefined)
                }
              }}
            >
              {[
                { value: "all", label: "All", count: records.length },
                { value: "active", label: "Active", count: active },
                { value: "attention", label: "Needs attention", count: attention },
                {
                  value: "finished",
                  label: "Finished",
                  count: records.filter((r) => !r.active && !r.attention).length,
                },
              ].map(({ value, label, count }) => (
                <ToggleGroupItem key={value} value={value} aria-label={label}>
                  {label}
                  <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Input
              aria-label="Search tasks"
              placeholder="Search tasks…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full sm:w-52"
            />
          </div>
          <Separator />
        </>
      )}
      {!records.length ? (
        <Empty className="m-5 flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListChecksIcon />
            </EmptyMedia>
            <EmptyTitle>{established ? "No tasks this run" : "Waiting for task observation"}</EmptyTitle>
            <EmptyDescription>
              Tasks appear here when you import or process content. Records are kept for this application
              session.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <ScrollArea
            className="min-h-0 min-w-0 basis-2/5 bg-muted/20 sm:w-[34%] sm:shrink-0 sm:basis-auto"
            viewportProps={{ "aria-label": "Task list" }}
          >
            <nav aria-label="Tasks" className="flex flex-col gap-1 p-2">
              {!filtered.length && (
                <p className="px-3 py-5 text-sm text-muted-foreground">No matching tasks.</p>
              )}
              {filtered.map((record) => {
                const running = record.attempts.filter((attempt) => attempt.task.state !== "terminal")
                const stage = running.length === 1 ? running[0].task : undefined
                const kind = record.attempts[0]?.task.operation.kind
                const Icon =
                  kind === "interpretation"
                    ? ScanLineIcon
                    : kind === "preview"
                      ? ImageIcon
                      : kind === "file_import"
                        ? FileIcon
                        : kind === "civitai"
                          ? BoxIcon
                          : kind === "upload" || kind === "upload_recovery"
                            ? UploadIcon
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
                        <span className="min-w-0 flex-1 truncate">{record.label}</span>
                        <Badge variant={record.attention ? "destructive" : "outline"} className="shrink-0">
                          {record.active ? (
                            <Spinner />
                          ) : record.attention ? (
                            <TriangleAlertIcon />
                          ) : (
                            <CheckIcon />
                          )}
                          {record.active ? "Active" : record.attention ? "Attention" : "Finished"}
                        </Badge>
                      </span>
                      <span className="line-clamp-2 whitespace-normal break-words text-xs font-normal leading-relaxed text-muted-foreground">
                        {record.summary}
                      </span>
                      {stage && (
                        <span className="truncate text-xs font-normal text-muted-foreground">
                          {stage.stage ?? stage.state.replaceAll("_", " ")}
                          {stage.completed != null &&
                            ` · ${stage.completed}${stage.total != null ? ` / ${stage.total}` : " completed"}`}
                        </span>
                      )}
                    </span>
                  </Button>
                )
              })}
            </nav>
          </ScrollArea>
          <Separator orientation="vertical" className="hidden sm:block" />
          <Separator className="sm:hidden" />
          <div className="min-h-0 min-w-0 flex-1">
            {!selected && (
              <Empty className="h-full">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ListChecksIcon />
                  </EmptyMedia>
                  <EmptyTitle>No matching tasks</EmptyTitle>
                  <EmptyDescription>Choose another status or clear your search.</EmptyDescription>
                </EmptyHeader>
                <Button
                  variant="outline"
                  onClick={() => {
                    setFilter("all")
                    setSearch("")
                  }}
                >
                  Show all tasks
                </Button>
              </Empty>
            )}
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

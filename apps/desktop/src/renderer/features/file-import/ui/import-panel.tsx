import { useState, useSyncExternalStore } from "react"
import {
  CheckIcon,
  ChevronRightIcon,
  FileIcon,
  ImportIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import { Separator } from "@/shared/ui/separator"
import { Spinner } from "@/shared/ui/spinner"
import type { Wire } from "@/shared/api"
import type { ImportCoordinator } from "../model/import-coordinator"
import { CivitaiOutcomeDetails } from "@/features/civitai"

const readable = (value: string) => value.replaceAll("_", " ")
function label(item: Wire<"ImportItem">) {
  if (item.active_request_id) return "Processing"
  if (item.current.complete) return "Complete"
  if (item.current.confirmed_file_id && !item.current.confirmed_entity_id)
    return "File registered; entry incomplete"
  if (item.current.base.state === "success") return "Admitted / processing incomplete"
  if (item.current.base.state === "uncertain") return "Admission unconfirmed"
  return "Not admitted"
}
function Details({ result }: { result: Wire<"ImportResult"> }) {
  const rows = [
    ["Copy", result.copy],
    ["File registration", result.registration],
    ["Entity establishment", result.base],
    ["File attachment", result.file_attachment],
    ["Twitter snapshot and attachment", result.twitter],
    ["Source/File association", result.association],
  ] as const
  return (
    <div className="flex flex-col gap-2 text-xs">
      {result.overall && <p>Overall result: {result.overall}</p>}
      {result.observation_problem && <p>Result observation: {result.observation_problem}</p>}
      {rows.map(([name, step]) => (
        <p key={name}>
          {name}: {readable(step.state)}
          {step.reason ? ` - ${step.reason}` : ""}
        </p>
      ))}
      {result.file_id && (
        <p className="break-all">
          {result.confirmed_file_id ? "Registered" : "Candidate"} File: {result.file_id}
        </p>
      )}
      {result.twitter_id && <p className="break-all">Twitter snapshot: {result.twitter_id}</p>}
      {result.entity_id && (
        <p className="break-all">
          {result.base.state === "success" ? "Confirmed" : "Candidate"} Entity: {result.entity_id}
        </p>
      )}
      {result.copied_bytes !== null && (
        <p>
          {result.copied_bytes} confirmed copied bytes
          {result.copy_complete ? " / completed preparation" : ""}
          {result.managed_bytes_may_exist ? " / managed bytes retained" : ""}
        </p>
      )}
      <div className="flex flex-col gap-1">
        <p className="font-medium">
          Model
          {result.model.component_id ? ` / ${result.model.component_id}` : ""}
        </p>
        {(["recognition", "establishment", "inspection"] as const).map((name) => (
          <p key={name}>
            {readable(name)}: {readable(result.model[name].state)}
            {result.model[name].reason ? ` - ${result.model[name].reason}` : ""}
          </p>
        ))}
      </div>
      {result.kinds.map((kind) => (
        <div key={kind.kind} className="flex flex-col gap-1">
          <p className="font-medium">
            {kind.kind === "image" ? "Image" : "Video"}
            {kind.component_id ? ` / ${kind.component_id}` : ""}
          </p>
          {(["recognition", "establishment", "interpretation", "preview"] as const).map((name) => (
            <p key={name}>
              {readable(name)}: {readable(kind[name].state)}
              {kind[name].reason ? ` - ${kind[name].reason}` : ""}
            </p>
          ))}
        </div>
      ))}
      {result.civitai && (
        <div className="flex flex-col gap-2">
          <p className="font-medium">Civitai · original weight enrichment</p>
          <CivitaiOutcomeDetails outcome={result.civitai} />
          <p>
            Continue unfinished provider work through this item’s whole-import recovery action. Page refresh
            is a separate operation.
          </p>
        </div>
      )}
    </div>
  )
}
export function ImportButton({ coordinator: c }: { coordinator: ImportCoordinator }) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={!c.available || c.selecting}
      title="Retain library copies; originals remain. Supported images, videos and model weights are processed automatically."
      onClick={() => void c.select()}
    >
      {c.selecting ? <Spinner data-icon="inline-start" /> : <ImportIcon data-icon="inline-start" />}
      Import
    </Button>
  )
}
export function ImportDetails({
  coordinator: c,
  batchId,
  pendingRequestId,
  view,
  tasks = [],
}: {
  coordinator: ImportCoordinator
  batchId: string
  pendingRequestId?: string
  tasks?: Wire<"PublicTask">[]
  view: (id: string) => Promise<string | undefined>
}) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  const [viewError, setViewError] = useState<string>()
  const [viewing, setViewing] = useState<string>()
  const ended = new Set(
    tasks
      .filter((task) => task.state === "terminal")
      .map((task) => `${task.access_context}:${task.request_id}`),
  )
  const currentBatch = c.batches.find((batch) => batch.batch_id === batchId)
  const originalRequestId =
    currentBatch?.access_context === "external"
      ? undefined
      : (pendingRequestId ??
        currentBatch?.original_request_id ??
        tasks.find(
          (task) =>
            task.access_context === "desktop" &&
            task.operation.kind === "import_batch" &&
            task.operation.batch_id === batchId,
        )?.request_id)
  const pending = [...c.submissions.values()].filter((s) =>
    "source_paths" in s.body ? s.body.request_id === originalRequestId : s.body.batch_id === batchId,
  )
  const items = c.batches.filter((b) => b.batch_id === batchId).flatMap((b) => b.items)
  async function show(id: string) {
    setViewing(id)
    setViewError(undefined)
    const error = await view(id)
    setViewing(undefined)
    if (error) setViewError(error)
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          Items <span className="ml-1 text-muted-foreground">{items.length}</span>
        </h3>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Check results"
          title="Refresh import results"
          disabled={c.observing}
          onClick={() => void c.observe()}
        >
          {c.observing ? <Spinner /> : <RefreshCwIcon />}
        </Button>
      </div>
      {(c.problem || viewError) && (
        <Alert>
          <AlertTitle>Result observation needs attention</AlertTitle>
          <AlertDescription>{viewError ?? c.problem}</AlertDescription>
        </Alert>
      )}
      {pending.map((s) => (
        <Alert key={s.body.request_id}>
          <AlertTitle>
            {s.pending
              ? "Establishing admission..."
              : s.accepted
                ? "Accepted; awaiting result observation"
                : "Submission unconfirmed"}
          </AlertTitle>
          <AlertDescription>
            {s.problem ?? "Retaining the original request identity."}
            {"source_paths" in s.body && <p className="break-all">{s.body.source_paths.join("; ")}</p>}
            <Button
              size="sm"
              variant="outline"
              disabled={s.pending}
              onClick={() => void c.checkRequest(s.body.request_id)}
            >
              Check original submission
            </Button>
          </AlertDescription>
        </Alert>
      ))}
      {!items.length && !pending.length && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Import details unavailable</EmptyTitle>
            <EmptyDescription>
              The task is known; check results to recover its business details.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {c.batches
        .filter((batch) => batch.batch_id === batchId)
        .map((batch) => (
          <section
            key={batch.batch_id}
            className="flex min-w-0 flex-col"
            aria-label={`Import batch ${batch.batch_id}`}
          >
            {batch.items.map((item, index) => (
              <article key={item.item_id} className="flex min-w-0 flex-col gap-3">
                {index > 0 && <Separator />}
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2 pt-1">
                  <FileIcon className="mt-1 size-4 shrink-0 text-muted-foreground" />
                  <div className="flex min-w-0 flex-1 basis-32 flex-col gap-1">
                    <p className="truncate text-sm font-medium" title={item.source_path}>
                      {item.supplied
                        ? item.requested_file
                          ? item.requested_twitter
                            ? "Registered File + Twitter"
                            : "Registered File"
                          : "Twitter only"
                        : item.source_path.split(/[\\/]/).pop() || item.source_path}
                    </p>
                    <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                      {(item.active_request_id &&
                        !ended.has(`${batch.access_context}:${item.active_request_id}`)) ||
                      c.itemPending(item.item_id) ? (
                        <Spinner className="mt-0.5 size-3.5 shrink-0" />
                      ) : item.current.complete ? (
                        <CheckIcon className="mt-0.5 size-3.5 shrink-0" />
                      ) : (
                        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                      )}
                      <span>
                        {item.active_request_id &&
                        ended.has(`${batch.access_context}:${item.active_request_id}`)
                          ? "Execution ended - details last known"
                          : c.itemPending(item.item_id)
                            ? "Recovery awaiting confirmation"
                            : label(item)}
                      </span>
                    </p>
                  </div>
                  <div className="ml-auto flex max-w-full flex-wrap gap-1.5">
                    {item.current.confirmed_entity_id &&
                      (!item.requested_file || item.current.file_attachment.state === "success") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-disabled={viewing === item.current.entity_id}
                          onClick={() => {
                            if (viewing !== item.current.entity_id) void show(item.current.entity_id!)
                          }}
                        >
                          {viewing === item.current.entity_id && <Spinner data-icon="inline-start" />}
                          View
                        </Button>
                      )}
                    {item.actions
                      .filter((a) => a !== "recopy" && batch.access_context === "desktop")
                      .map((action) => (
                        <Button
                          key={action}
                          size="sm"
                          variant="outline"
                          disabled={!c.available || c.itemPending(item.item_id)}
                          onClick={() => void c.recover(batch.batch_id, item.item_id, action)}
                        >
                          {action === "confirm"
                            ? "Check original result"
                            : item.current.confirmed_file_id || item.supplied
                              ? "Complete processing"
                              : "Reuse completed copy"}
                        </Button>
                      ))}
                  </div>
                </div>
                {batch.access_context === "external" && item.actions.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    This external import can be recovered by a holder of the current shared Token.
                  </p>
                )}
                {batch.access_context === "desktop" && item.actions.includes("recopy") && (
                  <Alert>
                    <AlertTitle>New copy required</AlertTitle>
                    <AlertDescription>
                      {item.current.copy.reason ?? item.current.base.reason} The source is read again and its
                      bytes may have changed. Earlier managed effects are retained.
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!c.available || c.itemPending(item.item_id)}
                        onClick={() => void c.recover(batch.batch_id, item.item_id, "recopy")}
                      >
                        Recopy source and import
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                <details className="group/file mb-3 ml-7 min-w-0">
                  <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
                    <ChevronRightIcon className="size-3.5 transition-transform group-open/file:rotate-90" />
                    Details
                  </summary>
                  <div className="mt-3 flex min-w-0 flex-col gap-4 rounded-lg bg-muted/30 p-3">
                    <p className="break-all text-xs text-muted-foreground">
                      {item.supplied
                        ? `Supplied scope: ${item.requested_file ? "registered File" : "no File requested"}${item.requested_twitter ? " / Twitter snapshot" : ""}`
                        : item.source_path}
                    </p>
                    <div className="flex min-w-0 flex-col gap-2">
                      <h4 className="text-xs font-medium">Current processing details</h4>
                      <Details result={item.current} />
                    </div>
                    <details className="group/attempts">
                      <summary className="flex cursor-pointer list-none items-start gap-1 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
                        <ChevronRightIcon className="size-3.5 shrink-0 transition-transform group-open/attempts:rotate-90" />
                        Original and recovery attempts ({item.attempts.length})
                      </summary>
                      <div className="mt-3 flex flex-col gap-3">
                        {item.attempts.map((attempt) => (
                          <div key={attempt.request_id} className="flex min-w-0 flex-col gap-2">
                            <Separator />
                            <p className="break-all text-xs">
                              {attempt.action} /{" "}
                              {attempt.ended || ended.has(`${batch.access_context}:${attempt.request_id}`)
                                ? "ended"
                                : "active"}{" "}
                              / {attempt.request_id}
                            </p>
                            <Details result={attempt.result} />
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                </details>
              </article>
            ))}
            <details className="group/original mt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRightIcon className="size-3.5 transition-transform group-open/original:rotate-90" />
                Original batch result
              </summary>
              <div className="mt-3 flex flex-col gap-2 text-xs text-muted-foreground">
                <p>
                  Original results:{" "}
                  {batch.items.filter((i) => i.attempts[0]?.ended && i.attempts[0].result.complete).length}{" "}
                  complete,{" "}
                  {batch.items.filter((i) => i.attempts[0]?.ended && !i.attempts[0].result.complete).length}{" "}
                  incomplete,{" "}
                  {
                    batch.items.filter(
                      (i) =>
                        !i.attempts[0]?.ended &&
                        !ended.has(`${batch.access_context}:${batch.original_request_id}`),
                    ).length
                  }{" "}
                  active
                </p>
                <p className="break-all">
                  Batch {batch.batch_id} / original{" "}
                  {batch.original_ended || ended.has(`${batch.access_context}:${batch.original_request_id}`)
                    ? "ended"
                    : "processing"}
                </p>
              </div>
            </details>
          </section>
        ))}
    </div>
  )
}

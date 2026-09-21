import { useState, useSyncExternalStore } from "react"
import { ImportIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import { Separator } from "@/shared/ui/separator"
import { Spinner } from "@/shared/ui/spinner"
import type { Wire } from "@/shared/api"
import type { ImportCoordinator } from "../model/import-coordinator"

const readable = (value: string) => value.replaceAll("_", " ")
function label(item: Wire<"ImportItem">) {
  if (item.active_request_id) return "Processing"
  if (item.current.complete) return "Complete"
  if (item.current.base.state === "success") return "Admitted / processing incomplete"
  if (item.current.base.state === "uncertain") return "Admission unconfirmed"
  return "Not admitted"
}
function Details({ result }: { result: Wire<"ImportResult"> }) {
  const rows = [
    ["Copy", result.copy],
    ["Admission", result.base],
  ] as const
  return (
    <div className="flex flex-col gap-2 text-xs">
      {result.observation_problem && <p>Result observation: {result.observation_problem}</p>}
      {rows.map(([name, step]) => (
        <p key={name}>
          {name}: {readable(step.state)}
          {step.reason ? ` - ${step.reason}` : ""}
        </p>
      ))}
      {result.file_id && (
        <p className="break-all">
          {result.base.state === "success" ? "Confirmed" : "Candidate"} File: {result.file_id}
        </p>
      )}
      {result.entity_id && (
        <p className="break-all">
          {result.base.state === "success" ? "Confirmed" : "Candidate"} Entity: {result.entity_id}
        </p>
      )}
      {result.copied_bytes !== null && (
        <p>
          {result.copied_bytes} confirmed copied bytes{result.copy_complete ? " / completed preparation" : ""}
          {result.managed_bytes_may_exist ? " / managed bytes retained" : ""}
        </p>
      )}
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
      title="Retain library copies; originals remain. Supported images and videos are processed automatically."
      onClick={() => void c.select()}
    >
      {c.selecting ? <Spinner data-icon="inline-start" /> : <ImportIcon data-icon="inline-start" />}Import
    </Button>
  )
}
export function ImportDetails({
  coordinator: c,
  batchId,
  view,
  tasks = [],
}: {
  coordinator: ImportCoordinator
  batchId: string
  tasks?: Wire<"PublicTask">[]
  view: (id: string) => Promise<string | undefined>
}) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  const [viewError, setViewError] = useState<string>()
  const [viewing, setViewing] = useState<string>()
  const ended = new Set(tasks.filter((task) => task.state === "terminal").map((task) => task.request_id))
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
      <p className="text-sm">Current results - {items.length} selected files</p>
      <Button size="sm" variant="outline" disabled={c.observing} onClick={() => void c.observe()}>
        Check results
      </Button>
      {(c.problem || viewError) && (
        <Alert>
          <AlertTitle>Result observation needs attention</AlertTitle>
          <AlertDescription>{viewError ?? c.problem}</AlertDescription>
        </Alert>
      )}
      {[...c.submissions.values()]
        .filter((s) => ("source_paths" in s.body ? s.body.request_id : s.body.batch_id) === batchId)
        .map((s) => (
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
      {!items.length &&
        ![...c.submissions.values()].some(
          (s) => ("source_paths" in s.body ? s.body.request_id : s.body.batch_id) === batchId,
        ) && (
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
            className="flex flex-col gap-3"
            aria-label={`Import batch ${batch.batch_id}`}
          >
            <p className="text-xs text-muted-foreground">
              Original results:{" "}
              {batch.items.filter((i) => i.attempts[0]?.ended && i.attempts[0].result.complete).length}{" "}
              complete,{" "}
              {batch.items.filter((i) => i.attempts[0]?.ended && !i.attempts[0].result.complete).length}{" "}
              incomplete,{" "}
              {batch.items.filter((i) => !i.attempts[0]?.ended && !ended.has(batch.batch_id)).length} active
            </p>
            <p className="text-xs text-muted-foreground">
              Batch {batch.batch_id} / original{" "}
              {batch.original_ended || ended.has(batch.batch_id) ? "ended" : "processing"}
            </p>
            {batch.items.map((item) => (
              <article key={item.item_id} className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-all text-sm">{item.source_path}</p>
                  <Badge variant="secondary">
                    {item.active_request_id && ended.has(item.active_request_id)
                      ? "Execution ended - details last known"
                      : c.itemPending(item.item_id)
                        ? "Recovery awaiting confirmation"
                        : label(item)}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.current.base.state === "success" && item.current.entity_id && (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-disabled={viewing === item.current.entity_id}
                      onClick={() => {
                        if (viewing !== item.current.entity_id) void show(item.current.entity_id!)
                      }}
                    >
                      View
                    </Button>
                  )}
                  {item.actions
                    .filter((a) => a !== "recopy")
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
                          : item.current.base.state === "success"
                            ? "Complete processing"
                            : "Reuse completed copy"}
                      </Button>
                    ))}
                </div>
                {item.actions.includes("recopy") && (
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
                <details>
                  <summary className="cursor-pointer text-sm">Current processing details</summary>
                  <Details result={item.current} />
                </details>
                <details>
                  <summary className="cursor-pointer text-sm">
                    Original and recovery attempts ({item.attempts.length})
                  </summary>
                  <div className="flex flex-col gap-3">
                    {item.attempts.map((attempt) => (
                      <div key={attempt.request_id} className="flex flex-col gap-2">
                        <Separator />
                        <p className="text-xs">
                          {attempt.action} /{" "}
                          {attempt.ended || ended.has(attempt.request_id) ? "ended" : "active"} /{" "}
                          {attempt.request_id}
                        </p>
                        <Details result={attempt.result} />
                      </div>
                    ))}
                  </div>
                </details>
              </article>
            ))}
          </section>
        ))}
    </div>
  )
}

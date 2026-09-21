import { useState, useSyncExternalStore } from "react"
import { ImportIcon, ListChecksIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/shared/ui/dialog"
import { Badge } from "@/shared/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import { ScrollArea } from "@/shared/ui/scroll-area"
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
export function ImportPanel({
  coordinator: c,
  view,
}: {
  coordinator: ImportCoordinator
  view: (id: string) => Promise<string | undefined>
}) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  const [open, setOpen] = useState(false)
  const [viewError, setViewError] = useState<string>()
  const [viewing, setViewing] = useState<string>()
  const items = c.batches.flatMap((b) => b.items)
  const active = items.filter((i) => !!i.active_request_id).length
  async function show(id: string) {
    setViewing(id)
    setViewError(undefined)
    const error = await view(id)
    setViewing(undefined)
    if (error) setViewError(error)
    else setOpen(false)
  }
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        disabled={!c.available || c.selecting}
        title="Retain library copies; originals remain. Supported images and videos are processed automatically."
        onClick={() => {
          setOpen(true)
          void c.select()
        }}
      >
        {c.selecting ? <Spinner data-icon="inline-start" /> : <ImportIcon data-icon="inline-start" />}Import
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <ListChecksIcon data-icon="inline-start" />
        Imports{active ? ` (${active})` : ""}
      </Button>
      {!open && c.feedback && (
        <Button size="sm" variant="ghost" aria-label={c.feedback} onClick={() => setOpen(true)}>
          <span role="status">{c.feedback}</span>
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85dvh] max-h-[48rem] flex-col overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Imports this run</DialogTitle>
            <DialogDescription>
              Files are copied into the library; originals remain. Supported images and videos are recognized,
              interpreted and given a thumbnail or cover.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm font-medium">Current results</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{items.length} selected</Badge>
            <Badge variant="outline">{active} processing</Badge>
            <Badge variant="outline">
              {items.filter((i) => !i.active_request_id && i.current.complete).length} complete
            </Badge>
            <Badge variant="outline">
              {items.filter((i) => !i.active_request_id && !i.current.complete).length} need attention
            </Badge>
            <Button size="sm" variant="outline" disabled={c.observing} onClick={() => void c.observe()}>
              Check results
            </Button>
          </div>
          {(c.problem || viewError) && (
            <Alert>
              <AlertTitle>Result needs attention</AlertTitle>
              <AlertDescription>{viewError ?? c.problem}</AlertDescription>
            </Alert>
          )}
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-5 pr-3">
              {[...c.submissions.values()].map((s) => (
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
              {!items.length && !c.submissions.size && (
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>No imports yet</EmptyTitle>
                    <EmptyDescription>
                      Choose Import to select local files. Canceling the picker submits nothing.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
              {c.batches.map((batch) => (
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
                    incomplete, {batch.items.filter((i) => !i.attempts[0]?.ended).length} active
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Batch {batch.batch_id} / original {batch.original_ended ? "ended" : "processing"}
                  </p>
                  {batch.items.map((item) => (
                    <article key={item.item_id} className="flex flex-col gap-3 rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 break-all text-sm">{item.source_path}</p>
                        <Badge variant="secondary">{label(item)}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {item.current.base.state === "success" && item.current.entity_id && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={viewing === item.current.entity_id}
                            onClick={() => void show(item.current.entity_id!)}
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
                                {attempt.action} / {attempt.ended ? "ended" : "active"} / {attempt.request_id}
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
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}

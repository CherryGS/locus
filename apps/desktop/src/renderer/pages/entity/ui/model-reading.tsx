import { useEffect, useRef, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { EntityComponent } from "@/entities/entity"
import type { Wire } from "@/shared/api"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import { Skeleton } from "@/shared/ui/skeleton"
import { ScrollArea } from "@/shared/ui/scroll-area"

type Model = Extract<EntityComponent, { kind: "model" }>
const integer = (v: string) => BigInt(v).toLocaleString()
export function ModelReading({ component: c }: { component: Model }) {
  const [tensors, setTensors] = useState(false)
  const [declarations, setDeclarations] = useState(false)
  const r = c.record,
    f = r?.facts,
    a = c.applicability
  const statuses = [
    c.readStatus === "loading" && r
      ? "Previous observation · rereading metadata."
      : c.previous
        ? "Previous observation · the latest reread failed."
        : undefined,
    r?.last_failure
      ? f
        ? "Retained inspection · the latest inspection failed."
        : "The first inspection failed; no accepted result is available."
      : undefined,
    a?.status === "changed"
      ? "This inspection describes a different File input."
      : a?.status === "unmounted"
        ? "This Model has no hosting Entity."
        : a?.status === "error"
          ? "Current input could not be observed."
          : a?.status === "incomplete" && a.current.status !== "file"
            ? "No current File input is available."
            : undefined,
    c.fileProblem ? "The current File record could not be read." : undefined,
  ].filter(Boolean)
  return (
    <ScrollArea className="min-h-0 flex-1">
      <article data-slot="model-reading" className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">Model weight file</h2>
            {f && <Badge variant="secondary">{f.format}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">Structure and declarations from one retained file inspection.</p>
        </header>
        {statuses.length > 0 && (
          <Alert>
            <AlertTitle>Inspection status</AlertTitle>
            <AlertDescription>
              {statuses.map((s) => (
                <p key={s}>{s}</p>
              ))}
              <p>See Overview for the affected component and detailed causes.</p>
            </AlertDescription>
          </Alert>
        )}
        {!r ? (
          c.readStatus === "loading" ? (
            <div className="flex flex-col gap-3" aria-label="Reading Model metadata">
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Model record unavailable</EmptyTitle>
                <EmptyDescription>
                  The attached Model could not be read. Use Reread Entity in Overview to observe it again.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        ) : !f ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No accepted inspection</EmptyTitle>
              <EmptyDescription>
                {r.last_failure
                  ? "The inspection failed. Its cause is available in Overview and import details."
                  : "This Model has not been inspected. This state does not imply a running task."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <section aria-label="Model overview" className="flex flex-col gap-3">
              <h3 className="font-medium">This file</h3>
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Tensors</dt>
                  <dd className="text-2xl tabular-nums">{integer(f.tensor_count)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Stored elements</dt>
                  <dd className="text-2xl tabular-nums">{integer(f.element_count)}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">{f.coverage}</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(f.storage_types).map(([type, s]) => (
                  <Badge key={type} variant="outline">
                    {type} · {integer(s.tensor_count)} {s.tensor_count === "1" ? "tensor" : "tensors"} ·{" "}
                    {integer(s.element_count)} {s.element_count === "1" ? "element" : "elements"}
                  </Badge>
                ))}
              </div>
              <p className="break-all text-xs text-muted-foreground">Accepted File: {r.basis}</p>
              {a?.status === "matching" && (
                <p className="text-xs text-muted-foreground">
                  The current File identity matches. Metadata reading does not check byte health or execution
                  compatibility.
                </p>
              )}
            </section>
            <section aria-label="Embedded declarations" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">File-provided declarations</h3>
                {f.declarations && Object.keys(f.declarations).length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-expanded={declarations}
                    onClick={() => setDeclarations((v) => !v)}
                  >
                    {declarations ? "Hide declarations" : `Read declarations (${Object.keys(f.declarations).length})`}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Embedded claims are not independently verified model properties.
              </p>
              {f.declarations === null || f.declarations === undefined ? (
                <p className="text-sm text-muted-foreground">No embedded metadata was supplied.</p>
              ) : Object.keys(f.declarations).length === 0 ? (
                <p className="text-sm text-muted-foreground">The file supplied an empty metadata map.</p>
              ) : declarations ? (
                <dl className="flex flex-col gap-3">
                  {Object.entries(f.declarations).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-xs text-muted-foreground break-all">{key}</dt>
                      <dd className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm">
                        {value || "(empty string)"}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </section>
            <section aria-label="Tensor descriptors" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">Tensor descriptors</h3>
                <Button variant="outline" size="sm" onClick={() => setTensors((v) => !v)} aria-expanded={tensors}>
                  {tensors ? "Hide tensors" : "Explore tensors"}
                </Button>
              </div>
              {tensors && <TensorList tensors={f.tensors} />}
            </section>
          </>
        )}
      </article>
    </ScrollArea>
  )
}
function TensorList({ tensors }: { tensors: Wire<"ModelTensor">[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<number>()
  const detailRef = useRef<HTMLDListElement>(null)
  useEffect(() => {
    if (selected !== undefined) detailRef.current?.scrollIntoView({ block: "nearest" })
  }, [selected])
  const virtual = useVirtualizer({
    count: tensors.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 48,
    overscan: 6,
  })
  const detail = selected === undefined ? undefined : tensors[selected]
  return (
    <div className="flex flex-col gap-3">
      {tensors.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tensor descriptors in this file.</p>
      ) : (
        <ScrollArea className="h-80 rounded-md border" viewportProps={{ ref, "aria-label": "Tensor list" }}>
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((row) => {
              const t = tensors[row.index]
              return (
                <div
                  key={row.key}
                  data-slot="tensor-row"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: row.size,
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <Button
                    variant={selected === row.index ? "secondary" : "ghost"}
                    aria-pressed={selected === row.index}
                    className="h-full w-full justify-start gap-3"
                    onClick={() => setSelected(row.index)}
                  >
                    <span className="min-w-0 flex-1 truncate text-left">{t.name}</span>
                    <Badge variant="outline">{t.storage_type}</Badge>
                  </Button>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      )}
      {detail && (
        <dl ref={detailRef} aria-label="Selected tensor" className="grid gap-2 rounded-md border p-4 text-sm">
          <dt className="text-xs text-muted-foreground">Tensor name</dt>
          <dd className="break-all">{detail.name}</dd>
          <dt className="text-xs text-muted-foreground">Shape</dt>
          <dd className="break-all">
            [{detail.shape.join(", ")}] {detail.shape.length === 0 ? "(scalar)" : ""}
          </dd>
          <dt className="text-xs text-muted-foreground">Storage type</dt>
          <dd>{detail.storage_type}</dd>
        </dl>
      )}
    </div>
  )
}

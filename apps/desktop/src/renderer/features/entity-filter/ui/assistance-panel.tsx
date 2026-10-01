import { useLayoutEffect, useRef, type RefObject } from "react"
import { RefreshCwIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Empty, EmptyHeader, EmptyTitle } from "@/shared/ui/empty"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Popover, PopoverContent, PopoverTitle } from "@/shared/ui/popover"
import { Separator } from "@/shared/ui/separator"
import { Spinner } from "@/shared/ui/spinner"
import type { FilterCoordinator } from "../model/filter-coordinator"
import { diagnosticPosition } from "../model/raw-input"
import { useAssistanceAnchor } from "./assistance-anchor"

export function AssistancePanel({ coordinator: c, inputRef }: {
  coordinator: FilterCoordinator; inputRef: RefObject<HTMLTextAreaElement | null>
}) {
  const a = c.assistance, viewport = useRef<HTMLDivElement>(null)
  const range = a.context?.kind === "field" ? a.context.field_range : a.context?.value_range
  const anchor = useAssistanceAnchor(inputRef, a.active,
    range ? diagnosticPosition(c.draft.source.text, range.start) : undefined)
  useLayoutEffect(() => {
    const scroller = viewport.current, current = scroller?.querySelector('[aria-current="true"]')
    if (!scroller || !current) return
    const row = current.getBoundingClientRect(), box = scroller.getBoundingClientRect()
    // Scroll only the candidates. scrollIntoView also moves the editor/modal,
    // separating the popup from the source the user is still typing into.
    if (row.top < box.top) scroller.scrollTop -= box.top - row.top
    else if (row.bottom > box.bottom) scroller.scrollTop += row.bottom - box.bottom
  }, [a.highlight, a.context?.kind, a.active])
  if (!a.active) return null
  const field = a.field, fields = a.context?.kind === "field", values = a.candidates
  return (
    <Popover open={!!anchor && !!(a.context || a.error)} modal={false} onOpenChange={(_open, details) => {
      // The textarea/coordinator owns literal departure and direct actions.
      // A floating menu must not reinterpret the source input as an outside click.
      details.cancel()
      if (details.reason === "escape-key") { a.exit(); details.event.stopPropagation() }
    }}>
      <PopoverContent id="filter-assistance" data-filter-helper-interaction
        aria-busy={a.editing || a.loading} style={{ animation: "none" }}
        align="start" sideOffset={6} initialFocus={false} finalFocus={false}
        positionerProps={{ anchor, positionMethod: "fixed", collisionPadding: 12,
          collisionAvoidance: { side: "flip", align: "shift" } }}
        className="w-96 max-w-[calc(100dvw-1.5rem)] max-h-(--available-height) gap-2 overflow-hidden"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); a.exit(); inputRef.current?.focus()
          } else if (event.key === "Enter" && (event.target as Element).closest('[aria-label^="Use "]')) {
            event.preventDefault(); void a.complete(); inputRef.current?.focus()
          }
        }}
        onBlurCapture={(event) => {
          if (!a.locked && !(event.relatedTarget as Element | null)?.closest('[data-filter-helper-interaction], #filter-source')) a.exit()
        }}
        onPointerDown={(event) => { if (!(event.target as Element).closest("summary")) event.preventDefault() }}>
        <div className="flex shrink-0 items-center gap-2 px-1">
          <div className="min-w-0 flex-1">
            <PopoverTitle className="truncate">{fields ? "Fields" : field?.id ?? "Query assistance"}</PopoverTitle>
            {field && !fields && <p className="text-xs text-muted-foreground">{field.owner} · {field.field_type} · {field.shape}{field.unit && ` · ${field.unit}`}</p>}
          </div>
          <div className="flex size-6 shrink-0 items-center justify-center">
            {a.editing || a.loading ? <Spinner aria-label="Updating suggestions" /> :
              field && field.assistance !== "manual" && !fields && <Button size="icon-xs" variant="ghost"
                aria-label="Refresh values" title="Refresh values" disabled={a.locked}
                onClick={() => a.refresh()}><RefreshCwIcon /></Button>}
          </div>
        </div>
        <ScrollArea className="min-h-0 min-w-0 overflow-clip"
          viewportProps={{ ref: viewport, className: "max-h-[min(16rem,calc(var(--available-height)-6rem))] overscroll-contain",
            "aria-label": fields ? "Assisted fields" : "Assisted values" }}>
          <div className="flex flex-col gap-2 pr-2">
            {fields && c.cataloguePending && <p role="status">Reading fields…</p>}
            {fields && c.catalogueError && <Alert variant="destructive"><AlertDescription>
              Fields unavailable: {c.catalogueError}<Button size="sm" variant="outline" onClick={() => void c.readCatalogue()}>Retry fields</Button>
            </AlertDescription></Alert>}
            {(fields || values.length > 0) && <div className="flex flex-col gap-1">
              {fields ? a.fieldCandidates.map((f, i) => <Button key={f.id} size="sm"
                variant={a.highlight === i ? "secondary" : "ghost"} aria-current={a.highlight === i}
                className="h-auto justify-start whitespace-normal py-1.5 text-left" aria-label={`Use field ${f.id}`}
                disabled={a.locked} aria-disabled={a.editing || undefined} onClick={() => a.acceptField(f)}>
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="break-all">{f.native_exact}:</span><span className="text-xs text-muted-foreground">{f.owner} · {f.field_type} · {f.shape}{f.unit && ` · ${f.unit}`}</span>
                </span>
              </Button>) : values.map((candidate, i) => <Button key={candidate.value} size="sm"
                variant={a.highlight === i ? "secondary" : "ghost"} aria-current={a.highlight === i}
                className="h-auto justify-start gap-3 whitespace-normal py-1.5 text-left" aria-label={`Use value ${candidate.value || "(empty)"}`}
                disabled={a.locked} aria-disabled={a.editing || a.loading || undefined} onClick={() => void a.acceptValue(candidate.value)}>
                <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{candidate.value || '"" (empty)'}</span>
                <Badge variant="outline">{candidate.declared && candidate.observed ? "Declared · observed" : candidate.declared ? "Declared" : "Observed"}</Badge>
              </Button>)}
            </div>}
            {a.loading && field?.assistance !== "strings" && !a.bounds && <p role="status" className="px-1 text-xs text-muted-foreground">Reading whole-library values…</p>}
            {fields && !c.cataloguePending && !c.catalogueError && !a.fieldCandidates.length &&
              <Empty className="p-2"><EmptyHeader><EmptyTitle>No matching fields</EmptyTitle></EmptyHeader></Empty>}
            {a.error && <Alert variant="destructive"><AlertDescription>{a.error}
              <Button size="sm" variant="outline" onClick={() => a.retry()}>Retry assistance</Button>
            </AlertDescription></Alert>}
            {!a.error && field?.assistance === "strings" && a.context?.kind === "value" && !a.observed.length &&
              <Empty className="p-2"><EmptyHeader><EmptyTitle>{a.editing || a.loading ? "Finding values…" : a.noValues ? "No observed values" : "No matching values"}</EmptyTitle></EmptyHeader></Empty>}
            {a.bounds && <p className="px-1 text-xs text-muted-foreground">
              {a.bounds.minimum && a.bounds.maximum ? <>Observed library range: <span className="select-text">{a.bounds.minimum.value} – {a.bounds.maximum.value}</span>{field?.unit && ` ${field.unit}`}</> : "No observed values"}
            </p>}
            {a.continuation && <Button size="sm" variant="outline" disabled={a.editing || a.loading || a.locked} onClick={() => void a.readDiscovery(true)}>More values</Button>}
            {a.help && <details className="px-1"><summary className="cursor-pointer text-xs text-muted-foreground">Writing help</summary>
              <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground"><p>{a.help.guidance}</p>
                {a.help.examples.map((example) => <code key={example} className="break-all whitespace-pre-wrap">{example}</code>)}
              </div>
            </details>}
            {a.helpError && <Alert variant="destructive"><AlertDescription>Writing help unavailable: {a.helpError}
              <Button size="sm" variant="outline" onClick={() => a.retryHelp()}>Retry writing help</Button>
            </AlertDescription></Alert>}
          </div>
        </ScrollArea>
        <Separator />
        <p id="filter-assistance-hint" className="shrink-0 px-1 text-xs text-muted-foreground">↑ ↓ navigate · Tab selects · Enter finishes · Esc keeps @</p>
      </PopoverContent>
    </Popover>
  )
}

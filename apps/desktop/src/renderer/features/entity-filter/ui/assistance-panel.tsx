import { useLayoutEffect, useRef, type RefObject } from "react"
import { BracesIcon, ChevronRightIcon, QuoteIcon, RefreshCwIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Empty, EmptyHeader, EmptyTitle } from "@/shared/ui/empty"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Popover, PopoverContent, PopoverTitle } from "@/shared/ui/popover"
import { Separator } from "@/shared/ui/separator"
import { Spinner } from "@/shared/ui/spinner"
import { Input } from "@/shared/ui/input"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/shared/ui/field"
import type { FilterCoordinator } from "../model/filter-coordinator"
import { diagnosticPosition } from "../model/raw-input"
import { useAssistanceAnchor } from "./assistance-anchor"

export function AssistancePanel({ coordinator: c, inputRef }: {
  coordinator: FilterCoordinator; inputRef: RefObject<HTMLTextAreaElement | null>
}) {
  const a = c.assistance, viewport = useRef<HTMLDivElement>(null), lookup = useRef<HTMLInputElement>(null)
  const focused = useRef<number | undefined>(undefined)
  const range = a.context?.kind === "field" ? a.context.field_range : a.context?.value_range
  const anchor = useAssistanceAnchor(inputRef, a.active,
    range ? diagnosticPosition(c.draft.source.text, range.start) : undefined)
  useLayoutEffect(() => {
    if (!a.active) { focused.current = undefined; return }
    if (anchor && a.session?.confirmed && a.session.lookupRequested && a.lookupAvailable && focused.current !== a.session.id && lookup.current) {
      focused.current = a.session.id
      lookup.current.focus()
    }
  })
  const finish = async (complete: boolean) => {
    const element = inputRef.current
    if (!element) return
    const position = element.selectionStart, marker = a.activeRange?.start
    if (complete && !await a.complete()) return
    if (!complete) a.exit()
    element.focus()
    const caret = Math.min(element.value.length, position - (complete && marker !== undefined && position > marker ? 1 : 0))
    element.setSelectionRange(caret, caret)
  }
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
  const examples = field?.assistance === "bounds" ? a.help?.examples : a.help?.examples.slice(0, 1)
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
            event.preventDefault(); event.stopPropagation(); void finish(false)
          } else if (event.key === "Enter" && ((event.target as Element).closest('[aria-label^="Use "]') || event.target === lookup.current)) {
            event.preventDefault(); event.stopPropagation(); void finish(true)
          } else if (event.target === lookup.current && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            if (a.move(event.key === "ArrowDown" ? 1 : -1)) event.preventDefault()
          } else if (event.target === lookup.current && event.key === "Tab" && !event.shiftKey && a.acceptHighlighted()) {
            event.preventDefault()
          }
        }}
        onBlurCapture={(event) => {
          if (!a.locked && !(event.relatedTarget as Element | null)?.closest('[data-filter-helper-interaction], #filter-source')) a.exit()
        }}
        onPointerDown={(event) => { if (!(event.target as Element).closest("input")) event.preventDefault() }}>
        <div className="flex shrink-0 items-center gap-2 px-1">
          <Badge variant={fields ? "secondary" : "outline"}>{fields ? "Field" : "Value"}</Badge>
          {a.lookupAvailable && <Badge variant="outline">Regex</Badge>}
          <div className="min-w-0 flex-1">
            <PopoverTitle className="truncate">{fields ? "Choose a field" : a.context?.reference || "Native query"}</PopoverTitle>
            {field && !fields && <p className="text-xs text-muted-foreground">{field.owner} · {field.field_type} · {field.shape}{field.unit && ` · ${field.unit}`}</p>}
          </div>
          <div className="flex size-6 shrink-0 items-center justify-center">
            {a.editing || a.loading ? <Spinner aria-label="Updating suggestions" /> :
              field && field.assistance !== "manual" && !fields && <Button size="icon-xs" variant="ghost"
                aria-label="Refresh values" title="Refresh values" disabled={a.locked}
                onClick={() => a.refresh()}><RefreshCwIcon /></Button>}
          </div>
        </div>
        {a.lookupAvailable && <FieldGroup className="shrink-0 px-1">
          <Field data-invalid={!!a.lookupError}>
            <FieldLabel htmlFor="filter-assistance-search" className="sr-only">{fields ? "Find fields with regex" : "Find values with regex"}</FieldLabel>
            <Input id="filter-assistance-search" ref={lookup} value={a.lookupText} disabled={a.locked}
              aria-invalid={!!a.lookupError} aria-describedby={a.lookupError ? "filter-assistance-regex-error" : "filter-assistance-hint"}
              placeholder={fields ? "bilibili.*id" : "Search original values with regex…"}
              spellCheck={false} autoComplete="off" onFocus={() => { a.lookupFocused = true }}
              onBlur={() => { a.lookupFocused = false }} onChange={(event) => a.setLookup(event.target.value)} />
            {a.lookupError && <FieldError id="filter-assistance-regex-error">{a.lookupError}</FieldError>}
          </Field>
        </FieldGroup>}
        <ScrollArea className="min-h-0 min-w-0 overflow-clip"
          viewportProps={{ ref: viewport, className: "max-h-[min(16rem,calc(var(--available-height)-6rem))] overscroll-contain",
            "aria-label": fields ? "Assisted fields" : "Assisted values" }}>
          <div className="flex flex-col gap-2 pr-2">
            {!fields && a.help && <section aria-label="Value syntax" className="flex flex-col gap-1 px-1 pb-1 text-xs">
              <p className="text-muted-foreground">{a.help.guidance.split(/(?<=\.)\s/)[0]}</p>
              {examples?.map((example) => <code key={example} className="break-all whitespace-pre-wrap">{example}</code>)}
            </section>}
            {fields && c.cataloguePending && <p role="status">Reading fields…</p>}
            {fields && c.catalogueError && <Alert variant="destructive"><AlertDescription>
              Fields unavailable: {c.catalogueError}<Button size="sm" variant="outline" onClick={() => void c.readCatalogue()}>Retry fields</Button>
            </AlertDescription></Alert>}
            {(fields || values.length > 0) && <div className="flex flex-col gap-1">
              {fields ? a.fieldCandidates.map((f, i) => <Button key={f.id} size="sm"
                variant={a.highlight === i ? "secondary" : "ghost"} aria-current={a.highlight === i}
                className="h-auto items-start justify-start gap-2 whitespace-normal py-1.5 text-left" aria-label={`Use field ${f.id}`}
                aria-describedby={a.highlight === i ? `filter-field-example-${i}` : undefined}
                disabled={a.locked} aria-disabled={a.editing || undefined} onClick={() => a.acceptField(f)}>
                <BracesIcon data-icon="inline-start" />
                <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                  <span className="break-all">{f.native_exact}:</span><span className="text-xs text-muted-foreground">{f.owner} · {f.field_type} · {f.shape}{f.unit && ` · ${f.unit}`}</span>
                  {a.highlight === i && <span id={`filter-field-example-${i}`} className="mt-1 flex h-12 w-full flex-col gap-0.5 text-xs text-muted-foreground">
                    <span>Example</span>
                    <code className="line-clamp-2 break-all">{a.help?.reference === f.native_exact ? a.help.examples[0] : a.helpError ? "Example unavailable" : "Reading example…"}</code>
                  </span>}
                </span>
                <ChevronRightIcon data-icon="inline-end" />
              </Button>) : values.map((candidate, i) => <Button key={candidate.value} size="sm"
                variant={a.highlight === i ? "secondary" : "ghost"} aria-current={a.highlight === i}
                className="h-auto justify-start gap-3 whitespace-normal py-1.5 text-left" aria-label={`Use value ${candidate.value || "(empty)"}`}
                disabled={a.locked} aria-disabled={a.editing || a.loading || undefined} onClick={() => void a.acceptValue(candidate.value)}>
                <QuoteIcon data-icon="inline-start" />
                <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{candidate.value || '"" (empty)'}</span>
                <Badge variant="outline">{candidate.declared && candidate.observed ? "Declared · observed" : candidate.declared ? "Declared" : "Observed"}</Badge>
              </Button>)}
            </div>}
            {a.loading && field?.assistance !== "strings" && !a.bounds && <p role="status" className="px-1 text-xs text-muted-foreground">Reading whole-library values…</p>}
            {fields && !a.lookupError && !c.cataloguePending && !c.catalogueError && !a.fieldCandidates.length &&
              <Empty className="p-2"><EmptyHeader><EmptyTitle>No matching fields</EmptyTitle></EmptyHeader></Empty>}
            {a.error && <Alert variant="destructive"><AlertDescription>{a.error}
              <Button size="sm" variant="outline" onClick={() => a.retry()}>Retry assistance</Button>
            </AlertDescription></Alert>}
            {!a.error && !a.lookupError && field?.assistance === "strings" && a.context?.kind === "value" && !a.observed.length &&
              <Empty className="p-2"><EmptyHeader><EmptyTitle>{a.editing || a.loading ? "Finding values…" : a.noValues ? "No observed values" : "No matching values"}</EmptyTitle></EmptyHeader></Empty>}
            {a.bounds && <p className="px-1 text-xs text-muted-foreground">
              {a.bounds.minimum && a.bounds.maximum ? <>Observed library range: <span className="select-text">{a.bounds.minimum.value} – {a.bounds.maximum.value}</span>{field?.unit && ` ${field.unit}`}</> : "No observed values"}
            </p>}
            {a.continuation && <Button size="sm" variant="outline" disabled={a.editing || a.loading || a.locked} onClick={() => void a.readDiscovery(true)}>More values</Button>}
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

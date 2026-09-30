import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import type { DialogRootActions } from "@base-ui/react/dialog"
import { BookOpenIcon, FilterIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/shared/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/shared/ui/field"
import { Input } from "@/shared/ui/input"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Badge } from "@/shared/ui/badge"
import { Spinner } from "@/shared/ui/spinner"
import { ScrollArea } from "@/shared/ui/scroll-area"
import type { FilterCoordinator } from "../model/filter-coordinator"
import { RawSourceInput } from "./raw-source-input"
import { PresetPicker } from "./preset-picker"
import { PresetOptions } from "./preset-options"
import { IndexStatus } from "./filter-feedback"
import { FieldReference } from "./field-reference"

export function FilterModal({ coordinator: c }: { coordinator: FilterCoordinator }) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  useEffect(() => () => c.close(), [c])
  const actions = useRef<DialogRootActions | null>(null),
    entry = useRef<HTMLButtonElement>(null)
  const [naming, setNaming] = useState<"save" | "save-as" | "rename" | "delete">(),
    [name, setName] = useState(""),
    [reference, setReference] = useState(false),
    [reveal, setReveal] = useState<number>()
  useLayoutEffect(() => {
    if (!c.open) {
      setNaming(undefined)
      if (c.hostClosing) actions.current?.unmount()
    }
  }, [c.open, c.hostClosing])
  const analysis =
    JSON.stringify(c.analysis?.source) === JSON.stringify(c.draft.source) ? c.analysis : undefined
  const closeReference = () => {
    setReference(false)
    queueMicrotask(() => document.getElementById("filter-source")?.focus())
  }
  return (
    <Dialog open={c.open} actionsRef={actions} onOpenChange={(open) => (open ? c.show() : c.close())}>
      <DialogTrigger ref={entry} render={<Button variant={c.filtered ? "secondary" : "outline"} size="sm" />}>
        <FilterIcon data-icon="inline-start" />
        Filter{c.filtered ? " · applied" : ""}
      </DialogTrigger>
      <DialogContent
        finalFocus={() => (c.hostClosing ? false : entry.current)}
        className={cn(
          "flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col sm:max-w-2xl",
          reference && "h-[min(38rem,calc(100dvh-2rem))] sm:max-w-5xl",
        )}
        aria-describedby="filter-description"
      >
        <DialogHeader className="pr-8">
          <div className="flex flex-wrap items-center gap-3">
            <DialogTitle>Filter Entities</DialogTitle>
            <Badge variant="secondary">
              {c.dirty ? "Unsaved draft" : c.saved ? "Saved preset" : "New draft"}
            </Badge>
          </div>
          <DialogDescription id="filter-description" className="sr-only">
            Write a query or load a saved preset. Apply once, or save it for reuse.
          </DialogDescription>
        </DialogHeader>
        <div className={cn(
          "grid min-h-0 flex-1 grid-cols-1 gap-4",
          reference && "sm:grid-cols-[minmax(0,1fr)_16rem] lg:grid-cols-[minmax(0,1fr)_20rem]",
        )}>
          <ScrollArea
            className={cn("min-h-0 min-w-0", reference && "max-sm:hidden")}
            viewportProps={{ "aria-label": "Filter editor", className: "overscroll-contain" }}
            scrollbarProps={{ className: "data-vertical:w-1.5" }}
          >
            <div className="flex flex-col gap-3 px-1 pr-3 pb-1">
              <FieldGroup>
                <div className="flex flex-wrap items-center gap-2">
                  <PresetPicker
                    presets={c.presets}
                    selected={c.saved}
                    disabled={c.busy}
                    loading={c.loading}
                    active={c.open}
                    error={c.presetsError}
                    onRetry={() => void c.readPresets()}
                    onSelect={(id) => c.requestSwitch(id)}
                  />
                  <Button variant="outline" disabled={c.busy} onClick={() => c.requestSwitch(null)}>
                    New
                  </Button>
                  <PresetOptions
                    coordinator={c}
                    onAction={(action) => {
                      setName(action === "rename" ? c.saved!.name : "")
                      setNaming(action)
                    }}
                  />
                </div>
                <Field data-invalid={analysis?.state === "invalid"}>
                  <div className="flex items-center justify-between gap-2">
                    <FieldLabel htmlFor="filter-source">Query</FieldLabel>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant={reference ? "secondary" : "ghost"}
                        aria-expanded={reference}
                        aria-controls="filter-field-reference"
                        onClick={() => reference ? closeReference() : setReference(true)}
                      >
                        <BookOpenIcon data-icon="inline-start" />Fields
                      </Button>
                      <Button size="sm" variant="ghost" disabled={c.busy} onClick={() => c.clear()}>
                        Clear
                      </Button>
                    </div>
                  </div>
                  <RawSourceInput
                    source={c.draft.source}
                    analysis={analysis}
                    disabled={c.busy}
                    change={(text) => c.edit({ ...c.draft, source: { ...c.draft.source, text } })}
                    reveal={reveal}
                    expanded={reference}
                  />
                </Field>
              </FieldGroup>
              <div aria-live="polite" className="flex flex-col gap-2">
                {c.analysisPending ? (
                  <p className="text-xs text-muted-foreground">Analyzing current source…</p>
                ) : (
                  analysis && (
                    <p className="text-xs text-muted-foreground">
                      {analysis.state === "valid"
                        ? "Query valid"
                        : analysis.state === "empty"
                          ? "All Entities"
                          : `Source ${analysis.state}`}
                    </p>
                  )
                )}
                {analysis?.diagnostics.map((d, i) => (
                  <Button
                    key={i}
                    variant="ghost"
                    className="h-auto justify-start whitespace-normal text-left"
                    onClick={() => {
                      setReveal(undefined)
                      queueMicrotask(() => setReveal(d.start))
                    }}
                  >
                    {d.message}
                  </Button>
                ))}
                {(c.analysisError || analysis?.state === "unavailable") && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      Analysis unavailable: {c.analysisError ?? "Retry validation when Search is ready."}
                      <Button size="sm" variant="outline" onClick={() => void c.analyze()}>
                        Retry analysis
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {c.notice && <p role="status">{c.notice}</p>}
                {c.error && (
                  <Alert variant="destructive">
                    <AlertDescription>{c.error}</AlertDescription>
                  </Alert>
                )}
                {c.uncertainWrites.map((write) => (
                  <details key={write.request}>
                    <summary className="cursor-pointer text-sm">
                      Unconfirmed {write.change?.operation ?? "save"} · {write.draft.name || "Untitled"}
                    </summary>
                    {/* Retain the exact submitted draft until the write outcome is reconciled. */}
                    <pre
                      aria-label="Retained draft for unconfirmed operation"
                      className="my-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs"
                    >
                      {write.draft.source.text}
                    </pre>
                    <Button variant="outline" onClick={() => void c.reconcile(write.request)}>
                      Reconcile uncertain operation
                    </Button>
                  </details>
                ))}
              </div>
              <IndexStatus coordinator={c} />
            </div>
          </ScrollArea>
          {reference && (
            <FieldReference coordinator={c} close={closeReference} />
          )}
        </div>
        <DialogFooter className="flex-row flex-wrap items-center">
          <span className="mr-auto text-xs text-muted-foreground">
            {c.established
              ? `${c.filtered ? "Filtered" : "Library"} · ${c.sequence!.length.toLocaleString()} Entities`
              : "No complete result"}
          </span>
          <Button
            variant="outline"
            disabled={c.busy}
            onClick={() => {
              if (!c.saved && !c.draft.name.trim()) {
                setName("")
                setNaming("save")
              } else void c.save()
            }}
          >
            {c.saving && <Spinner data-icon="inline-start" />}Save
          </Button>
          <Button disabled={c.busy} onClick={() => void c.apply()}>
            {c.pending === "apply" && <Spinner data-icon="inline-start" />}Apply
          </Button>
        </DialogFooter>
        <Dialog
          open={!!c.guard}
          onOpenChange={(open) => {
            if (!open) void c.resolveGuard("cancel")
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Unsaved Filter edits</DialogTitle>
              <DialogDescription>
                Save this draft before switching, discard its edits, or stay here.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => void c.resolveGuard("cancel")}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => void c.resolveGuard("discard")}>
                Discard
              </Button>
              <Button onClick={() => void c.resolveGuard("save")}>Save and switch</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!naming}
          onOpenChange={(open) => {
            if (!open) setNaming(undefined)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {naming === "delete"
                  ? `Delete “${c.saved?.name}”?`
                  : naming === "rename"
                    ? "Rename preset"
                    : naming === "save"
                      ? "Save preset"
                      : "Save As"}
              </DialogTitle>
              <DialogDescription>
                {naming === "delete"
                  ? "The reusable preset will be removed. Your source and established result remain."
                  : "Use a distinct, nonblank library preset name."}
              </DialogDescription>
            </DialogHeader>
            {naming !== "delete" && (
              <Field>
                <FieldLabel htmlFor="preset-new-name">Name</FieldLabel>
                <Input id="preset-new-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setNaming(undefined)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const kind = naming
                  setNaming(undefined)
                  if (kind === "delete") void c.deletePreset()
                  else if (kind === "rename") void c.rename(name)
                  else void c.save(name)
                }}
              >
                {naming === "delete" ? "Confirm delete" : "Confirm name"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}

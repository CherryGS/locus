import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import type { DialogRootActions } from "@base-ui/react/dialog"
import type { Wire } from "@/shared/api"
import { BookOpenIcon, FilterIcon, TriangleAlertIcon, XIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/shared/ui/button"
import { InputGroupButton } from "@/shared/ui/input-group"
import {
  Dialog,
  DialogClose,
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
import { Spinner } from "@/shared/ui/spinner"
import { ScrollArea } from "@/shared/ui/scroll-area"
import type { FilterCoordinator } from "../model/filter-coordinator"
import { RawSourceInput } from "./raw-source-input"
import { PresetPicker } from "./preset-picker"
import { IndexStatus } from "./filter-feedback"
import { FieldReference } from "./field-reference"
import { AssistancePanel } from "./assistance-panel"

export function FilterModal({ coordinator: c, embedded = false }: { coordinator: FilterCoordinator; embedded?: boolean }) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  useEffect(() => () => c.close(), [c])
  const actions = useRef<DialogRootActions | null>(null),
    entry = useRef<HTMLButtonElement>(null),
    sourceInput = useRef<HTMLTextAreaElement>(null)
  const [naming, setNaming] = useState<"save" | "save-as" | "rename" | "delete">(),
    [name, setName] = useState(""),
    [pickerOpen, setPickerOpen] = useState(false),
    [managed, setManaged] = useState<Wire<"FilterPresetSummary">>(),
    [reference, setReference] = useState(false),
    [resizeHint, setResizeHint] = useState(false),
    [reveal, setReveal] = useState<number>()
  useLayoutEffect(() => {
    if (!c.open) {
      setNaming(undefined)
      setPickerOpen(false)
      setResizeHint(false)
      if (c.hostClosing) actions.current?.unmount()
    }
  }, [c.open, c.hostClosing])
  useLayoutEffect(() => {
    if (naming || c.guard) setPickerOpen(false)
  }, [naming, c.guard])
  const analysis =
    !c.assistance.active && JSON.stringify(c.analysis?.source) === JSON.stringify(c.draft.source) ? c.analysis : undefined
  const closeReference = () => {
    setReference(false)
    queueMicrotask(() => document.getElementById("filter-source")?.focus())
  }
  return (
    <Dialog open={c.open} actionsRef={actions} onOpenChange={(open) => (open ? c.show() : c.close())}>
      <DialogTrigger ref={entry}
        aria-label={c.filterApplied ? "Filter · applied" : "Filter"}
        title={c.filterApplied ? "Filter · applied" : "Filter"}
        render={embedded
          ? <InputGroupButton size="icon-xs" variant={c.filterApplied ? "secondary" : "ghost"} />
          : <Button variant={c.filterApplied ? "secondary" : "outline"} size="sm" />}>
        <FilterIcon data-icon="inline-start" />
        {!embedded && <>Filter{c.filterApplied ? " · applied" : ""}</>}
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        finalFocus={() => (c.hostClosing ? false : entry.current)}
        className={cn(
          "filter-dialog flex max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100dvw-2rem))] flex-col",
          reference
            ? "h-[min(44rem,calc(100dvh-2rem))] min-h-[min(32rem,calc(100dvh-2rem))] min-w-[min(30rem,calc(100dvw-2rem))] max-w-[calc(100dvw-2rem)] resize overflow-hidden sm:max-w-[calc(100dvw-2rem)]"
            : "sm:max-w-2xl",
        )}
        aria-describedby="filter-description"
        data-field-reference-open={reference}
        data-resize-hover={reference && resizeHint}
        onPointerDownCapture={(event) => {
          // Keep the target in place until its click is dispatched. Collapsing
          // assistance during pointerdown/blur can recenter this dialog and
          // move Load/New away from the pointer before their click arrives.
          if (c.assistance.active && (event.target as Element).closest("button")) event.preventDefault()
        }}
        onClickCapture={(event) => {
          if (!(event.target as Element).closest('[data-filter-helper-interaction], [data-filter-direct-action], #filter-source')) c.assistance.exit()
        }}
        onPointerMove={(event) => {
          if (!reference) return
          const box = event.currentTarget.getBoundingClientRect()
          const next = event.clientX >= box.right - 16 && event.clientY >= box.bottom - 16
          if (next !== resizeHint) setResizeHint(next)
        }}
        onPointerLeave={() => setResizeHint(false)}
      >
        <DialogTitle className="sr-only">Filter Entities</DialogTitle>
        <DialogDescription id="filter-description" className="sr-only">
          Write a query or load a saved preset. Apply once, or save it for reuse.
        </DialogDescription>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <ScrollArea
            className={cn("min-h-0 min-w-0", reference ? "max-h-[min(23rem,calc(100dvh-18rem))] shrink-0" : "flex-1")}
            viewportProps={{
              "aria-label": "Filter editor",
              className: cn("overscroll-contain", reference && "max-h-[min(23rem,calc(100dvh-18rem))]"),
            }}
            scrollbarProps={{ className: "data-vertical:w-1.5" }}
          >
            <div className="flex flex-col gap-3 px-1 pr-3 pb-1">
              <FieldGroup className="gap-4">
                <div className="flex min-w-0 items-center gap-2">
                  <PresetPicker
                    open={pickerOpen}
                    onOpenChange={setPickerOpen}
                    restoreFocus={!naming && !c.guard}
                    presets={c.presets}
                    selected={c.saved}
                    disabled={c.busy}
                    loading={c.loading}
                    active={c.open}
                    error={c.presetsError}
                    onRetry={() => void c.readPresets()}
                    onSelect={(id) => c.requestSwitch(id)}
                    onManage={(preset, action) => {
                      setManaged(preset)
                      setName(preset.name)
                      setNaming(action)
                    }}
                  />
                  <Button variant="ghost" disabled={c.busy} onClick={() => c.requestSwitch(null)}>
                    New
                  </Button>
                  <DialogClose render={<Button variant="ghost" size="icon" />}>
                    <XIcon />
                    <span className="sr-only">Close</span>
                  </DialogClose>
                </div>
                <Field className="gap-2" data-invalid={analysis?.state === "invalid"}>
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
                    reveal={reveal}
                    assistance={c.assistance}
                    inputRef={sourceInput}
                  />
                  <AssistancePanel coordinator={c} inputRef={sourceInput} />
                </Field>
              </FieldGroup>
              <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
                {analysis && analysis.state !== "valid" && analysis.state !== "empty" && (
                  <p className="text-xs text-muted-foreground">Source {analysis.state}</p>
                )}
                {analysis?.diagnostics.map((d, i) => (
                  <Button
                    key={i}
                    variant="ghost"
                    className="h-auto items-start justify-start rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 whitespace-normal text-left text-xs leading-5 text-foreground hover:bg-destructive/15"
                    onClick={() => {
                      setReveal(undefined)
                      queueMicrotask(() => setReveal(d.start))
                    }}
                  >
                    <TriangleAlertIcon className="mt-0.5 shrink-0 text-destructive" data-icon="inline-start" />
                    <span>{d.message}</span>
                  </Button>
                ))}
                {!c.assistance.active && (c.analysisError || analysis?.state === "unavailable") && (
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
                      Unconfirmed {write.change?.operation ?? "save"} · {write.change && "id" in write.change
                        ? write.change.id
                        : write.change && "name" in write.change ? write.change.name : write.draft.name || "Untitled"}
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
            <FieldReference coordinator={c} />
          )}
        </div>
        <DialogFooter className="shrink-0 flex-row flex-wrap items-center bg-background/50 [@media(max-height:600px)]:py-3">
          <span className="mr-auto text-xs text-muted-foreground tabular-nums">
            {c.established
              ? `${c.filtered ? "Filtered" : "Library"} · ${c.sequence!.length.toLocaleString()} Entities`
              : "No complete result"}
          </span>
          <Button
            variant="outline"
            disabled={c.busy}
            data-filter-direct-action
            onPointerDown={(event) => event.preventDefault()}
            onClick={async () => {
              if (!await c.prepareHelperAction()) return
              if (!c.saved && !c.draft.name.trim()) {
                setName("")
                setNaming("save")
              } else void c.save()
            }}
          >
            {c.saving && <Spinner data-icon="inline-start" />}Save
          </Button>
          <Button variant="outline" disabled={c.busy} data-filter-direct-action
            onPointerDown={(event) => event.preventDefault()}
            onClick={async () => {
              if (!await c.prepareHelperAction()) return
              setName("")
              setNaming("save-as")
            }}>Save As</Button>
          <Button disabled={c.busy} data-filter-direct-action
            onPointerDown={(event) => event.preventDefault()} onClick={() => void c.apply()}>
            {c.pending === "apply" && <Spinner data-icon="inline-start" />}Apply
          </Button>
        </DialogFooter>
        {reference && <span aria-hidden="true" className="filter-resize-hint pointer-events-none absolute right-1 bottom-1 size-3" />}
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
                  ? `Delete “${managed?.name}”?`
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
                  if (kind === "delete") void c.deletePreset(managed)
                  else if (kind === "rename") void c.rename(name, managed)
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

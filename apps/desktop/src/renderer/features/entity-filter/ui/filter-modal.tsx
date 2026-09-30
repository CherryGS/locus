import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import type { DialogRootActions } from "@base-ui/react/dialog"
import { FilterIcon } from "lucide-react"
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
import type { FilterCoordinator } from "../model/filter-coordinator"
import { RawSourceInput } from "./raw-source-input"
import { PresetPicker } from "./preset-picker"
import { PresetOptions } from "./preset-options"
import { IndexStatus } from "./filter-feedback"

export function FilterModal({ coordinator: c }: { coordinator: FilterCoordinator }) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  useEffect(() => () => c.close(), [c])
  const actions = useRef<DialogRootActions | null>(null),
    entry = useRef<HTMLButtonElement>(null)
  const [naming, setNaming] = useState<"save" | "save-as" | "rename" | "delete">(),
    [name, setName] = useState(""),
    [find, setFind] = useState(""),
    [reveal, setReveal] = useState<number>()
  useLayoutEffect(() => {
    if (!c.open) {
      setNaming(undefined)
      if (c.hostClosing) actions.current?.unmount()
    }
  }, [c.open, c.hostClosing])
  const groups = new Map<string, NonNullable<typeof c.catalogue>["fields"]>()
  for (const f of c.catalogue?.fields ?? [])
    if (`${f.owner} ${f.id}`.toLowerCase().includes(find.toLowerCase()))
      groups.set(f.owner, [...(groups.get(f.owner) ?? []), f])
  const analysis =
    JSON.stringify(c.analysis?.source) === JSON.stringify(c.draft.source) ? c.analysis : undefined
  return (
    <Dialog open={c.open} actionsRef={actions} onOpenChange={(open) => (open ? c.show() : c.close())}>
      <DialogTrigger ref={entry} render={<Button variant={c.filtered ? "secondary" : "outline"} size="sm" />}>
        <FilterIcon data-icon="inline-start" />
        Filter{c.filtered ? " · applied" : ""}
      </DialogTrigger>
      <DialogContent
        finalFocus={() => (c.hostClosing ? false : entry.current)}
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl"
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
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-1 pb-1">
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
                <Button size="sm" variant="ghost" disabled={c.busy} onClick={() => c.clear()}>
                  Clear
                </Button>
              </div>
              <RawSourceInput
                source={c.draft.source}
                analysis={analysis}
                disabled={c.busy}
                change={(text) => c.edit({ ...c.draft, source: { ...c.draft.source, text } })}
                reveal={reveal}
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
                      ? "Empty query shows all Entities."
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
                <p className="mt-2 text-xs text-muted-foreground">
                  The draft retained for this attempt remains available to copy while its outcome is
                  reconciled.
                </p>
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
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">Fields and syntax</summary>
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">
                {c.draft.source.format || "Reading source profile…"} · version {c.draft.source.version}.
                Plain query text; formatting is preserved. Execution is checked on Apply.
              </p>
              {c.cataloguePending && <p>Reading catalogue…</p>}
              {c.catalogueError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {c.catalogueError}
                    <Button size="sm" onClick={() => void c.readCatalogue()}>
                      Retry catalogue
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              <Field>
                <FieldLabel htmlFor="filter-find">Find fields</FieldLabel>
                <Input id="filter-find" value={find} onChange={(e) => setFind(e.target.value)} />
              </Field>
              {[...groups].map(([owner, fields]) => (
                <section key={owner}>
                  <h3 className="text-sm font-medium">{owner}</h3>
                  <div className="flex flex-wrap gap-1">
                    {fields.map((f) => (
                      <div key={f.id} className="flex flex-col gap-1 rounded-md border p-2 text-xs">
                        <span>{f.id}</span>
                        <span className="text-muted-foreground">
                          {f.field_type} · {f.shape} · {f.unit ?? "no unit"}
                        </span>
                        <code>
                          Analyzed/value: {f.native_value} · Exact: {f.native_exact}
                        </code>
                        {f.owner === "tag" && (
                          <code>
                            Example: {f.native_exact}:
                            {JSON.stringify(f.field_type === "text" ? "cat" : "Tag ID from component details")}
                          </code>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              {c.language?.syntax.map((s) => (
                <p className="text-xs text-muted-foreground" key={s}>
                  {s}
                </p>
              ))}
              {c.helpError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Help unavailable: {c.helpError}
                    <Button size="sm" onClick={() => void c.readHelp()}>
                      Retry help
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </details>
          <IndexStatus coordinator={c} />
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

import { useEffect, useId, useRef, useSyncExternalStore } from "react"
import { cn } from "@/shared/lib/utils"
import { useDelayedPending } from "@/shared/lib/use-delayed-pending"
import { Button } from "@/shared/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/shared/ui/field"
import { InputGroup, InputGroupTextarea } from "@/shared/ui/input-group"
import { Spinner } from "@/shared/ui/spinner"
import type { EntityNotesCoordinator } from "../model/entity-notes"

export function EntityNotesEditor({ entityId, coordinator: c }: {
  entityId: string
  coordinator: EntityNotesCoordinator
}) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  const s = c.get(entityId)
  const field = useId()
  const composing = useRef(false)
  useEffect(() => {
    void c.read(s)
    return () => { if (!s.error) void c.save(s) }
  }, [c, s])
  const dirty = s.saved !== undefined && s.draft !== s.saved
  const saving = useDelayedPending(!!s.work)
  const reading = useDelayedPending(s.reading)
  const busy = saving || reading
  const status = s.error
    ? s.attempt ? "Unconfirmed" : s.saved === undefined ? "Unavailable" : "Not saved"
    : saving ? "Saving…"
    : reading ? s.saved === undefined ? "Loading…" : "Refreshing…"
    : dirty ? "Unsaved"
    : ""
  return (
    <section aria-label="Entity notes" className="px-4 py-4">
      <FieldGroup>
        <Field>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor={field}>Notes</FieldLabel>
            <span role="status" className="flex h-4 w-24 shrink-0 items-center justify-end gap-1 whitespace-nowrap text-xs text-muted-foreground">
              <span aria-hidden="true" className="relative size-3 shrink-0">
                <Spinner aria-hidden="true" role={undefined} className={cn("absolute inset-0 size-3 motion-reduce:animate-none", !busy && "invisible")} />
              </span>
              <span>{status}</span>
            </span>
          </div>
          <InputGroup className={cn(s.saved !== undefined && c.editable && "has-disabled:bg-control has-disabled:opacity-100")}>
            <InputGroupTextarea id={field} value={s.draft} placeholder="Add a note, an idea, a reminder…"
              className="min-h-24 resize-y disabled:opacity-100"
              disabled={s.saved === undefined || s.reading || !c.editable}
              onChange={(event) => c.update(s, event.target.value, composing.current)}
              onCompositionStart={() => { composing.current = true; c.update(s, s.draft, true) }}
              onCompositionEnd={(event) => { composing.current = false; c.update(s, event.currentTarget.value) }}
              onBlur={() => { if (!s.error && !composing.current) void c.save(s) }}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  void c.save(s)
                }
              }} />
          </InputGroup>
          {s.error && <div className="flex flex-col items-start gap-2" role="alert">
            <p className="break-words text-xs text-destructive">{s.error}</p>
            <Button size="xs" variant="outline" disabled={!c.editable || !!s.work || s.reading}
              onClick={() => void (s.saved === undefined ? c.read(s) : c.save(s))}>
              {s.saved === undefined ? "Retry notes" : "Retry save"}
            </Button>
          </div>}
        </Field>
      </FieldGroup>
    </section>
  )
}

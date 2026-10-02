import { useEffect, useId, useRef, useSyncExternalStore } from "react"
import { CheckIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/shared/ui/field"
import { Textarea } from "@/shared/ui/textarea"
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
  return (
    <section aria-label="Entity notes" className="px-4 py-4">
      <FieldGroup>
        <Field>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor={field}>Notes</FieldLabel>
            <span role="status" className="flex items-center gap-1 text-xs text-muted-foreground">
              {s.work ? <><Spinner />Saving…</> : s.reading ? "Loading…" : s.error ? (s.attempt ? "Unconfirmed" : s.saved === undefined ? "Unavailable" : "Not saved") : dirty ? "Unsaved" : s.saved !== undefined ? <><CheckIcon className="size-3" />Saved</> : ""}
            </span>
          </div>
          <Textarea id={field} value={s.draft} placeholder="Add a note, an idea, a reminder…"
            className="min-h-28 resize-y" disabled={s.saved === undefined || s.reading || !c.editable}
            aria-describedby={`${field}-hint`}
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
          <p id={`${field}-hint`} className="text-xs text-muted-foreground">Saves automatically.</p>
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

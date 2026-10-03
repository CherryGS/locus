import { useId, useRef, useSyncExternalStore } from "react"
import { SearchIcon, XIcon } from "lucide-react"
import { Field, FieldGroup, FieldLabel } from "@/shared/ui/field"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/shared/ui/input-group"
import { Spinner } from "@/shared/ui/spinner"
import { useDelayedPending } from "@/shared/lib/use-delayed-pending"
import type { FilterCoordinator } from "../model/filter-coordinator"

export function EntitySearch({ coordinator: c }: { coordinator: FilterCoordinator }) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  const pending = useDelayedPending(c.pending === "search")
  const changed = c.searchDraft.trim() !== c.appliedSearch
  const inputId = useId()
  const statusId = useId()
  const input = useRef<HTMLInputElement>(null)
  return <form role="search" aria-label="Search Entities" className="min-w-0 flex-1" onSubmit={event => { event.preventDefault(); void c.applySearch() }}>
    <FieldGroup>
      <Field data-invalid={!!c.searchError}>
        <FieldLabel htmlFor={inputId} className="sr-only">Search entities</FieldLabel>
        <InputGroup>
          <InputGroupAddon>
            <InputGroupButton type="submit" size="icon-xs" aria-label="Apply search" title="Search (Enter)" disabled={c.busy}>
              {pending ? <Spinner /> : <SearchIcon />}
            </InputGroupButton>
          </InputGroupAddon>
          <InputGroupInput ref={input} id={inputId} placeholder="Search entities…" value={c.searchDraft}
            aria-invalid={!!c.searchError} aria-describedby={statusId} onChange={event => c.editSearch(event.target.value)} />
          {!!c.searchDraft && <InputGroupAddon align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="Clear search" title="Clear search" disabled={c.busy}
              onClick={() => { c.editSearch(""); input.current?.focus({ preventScroll: true }); void c.applySearch() }}><XIcon /></InputGroupButton>
          </InputGroupAddon>}
        </InputGroup>
        <span id={statusId} role="status" className="sr-only">{c.searchError ?? (changed ? "Press Enter to apply search" : pending ? "Searching" : undefined)}</span>
      </Field>
    </FieldGroup>
  </form>
}

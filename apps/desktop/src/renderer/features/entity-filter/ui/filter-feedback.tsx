import { useSyncExternalStore } from "react"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { humanize } from "../model/draft"
import type { FilterCoordinator } from "../model/filter-coordinator"

export function IndexStatus({ coordinator: c }: { coordinator: FilterCoordinator }) {
  const status = c.status
  return (
    <div className="flex flex-col gap-2" aria-label="Search index status">
      <p className="text-xs text-muted-foreground">
        {c.statusError
          ? `Index status unknown: ${c.statusError}`
          : status
            ? `Index ${humanize(status.state)} · ${status.usable ? "search available" : "search unavailable"}${status.total ? ` · ${status.completed} / ${status.total} Entities` : ""}`
            : "Reading index status…"}
      </p>
      {!c.statusError && status?.failure && (
        <Alert variant="destructive">
          <AlertDescription>
            {status.failure}
            {" New queries require aligned data; your established result is retained."}
          </AlertDescription>
        </Alert>
      )}
      {!c.statusError && status && (
        <p className="text-xs text-muted-foreground">
          {status.covered_sequence !== status.journal_head
            ? "Recent changes are waiting to be indexed. "
            : ""}
          Index updates keep your current result unchanged; use Refresh when you want to update it.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" disabled={c.statusPending} onClick={() => void c.readStatus()}>
          Check index status
        </Button>
        {!c.statusError && status && (!status.usable || !!status.failure) && (
          <Button
            size="sm"
            variant="outline"
            disabled={!!c.maintenancePending}
            onClick={() => void c.maintain("retry")}
          >
            Retry indexing
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={!!c.maintenancePending}
          onClick={() => void c.maintain("rebuild")}
        >
          Rebuild index
        </Button>
      </div>
      {c.maintenancePending && <p role="status">Requesting index {c.maintenancePending}…</p>}
      {c.maintenanceError && (
        <Alert variant="destructive">
          <AlertDescription>Index maintenance: {c.maintenanceError}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
export function FilterResultStatus({ coordinator: c }: { coordinator: FilterCoordinator }) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  if (!c.filtered) return null
  const observation = c.established?.observation
  const status = c.statusError ? undefined : c.status
  const newer =
    !!observation &&
    !!status?.usable &&
    !!status.generation &&
    (observation.generation !== status.generation || observation.coveredSequence !== status.covered_sequence)
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-4 pb-2 text-xs text-muted-foreground"
      aria-label="Applied Filter result"
    >
      <Badge variant="secondary">{c.sequence?.length === 0 ? "No matches" : "Filtered result"}</Badge>
      <span className="min-w-0 break-words">
        {c.established?.criteria?.text ? c.established.criteria.text : "Native Filter applied"}
      </span>
      {newer && <span>A newer index is ready. Refresh to update this result.</span>}
      {status && status.covered_sequence !== status.journal_head && <span>Index updates pending.</span>}
      {status?.failure && <span>Index update failed{"; established results remain available."}</span>}
      {c.statusError && <span>Index status unknown.</span>}
      {status && !status.usable && <span>Search currently unavailable; completed results retained.</span>}
    </div>
  )
}
export function FilterEvidence({
  coordinator: c,
  entity,
}: {
  coordinator: FilterCoordinator
  entity: string
}) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  if (!c.filtered) return null
  const evidence = c.evidence?.entity === entity ? c.evidence : undefined
  return (
    <div className="flex flex-col gap-2" aria-label="Original result match evidence">
      <p className="text-xs text-muted-foreground">
        Why this Entity matched when you applied the Filter. Its current metadata may have changed since then.
      </p>
      {c.evidenceExpired ? (
        <p>Original match evidence expired or is unavailable. The complete result is retained.</p>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={evidence?.pending}
          onClick={() => void c.readEvidence(entity)}
        >
          {evidence?.pending
            ? "Reading match evidence…"
            : evidence?.error
              ? "Retry match evidence"
              : "Why this matched"}
        </Button>
      )}
      {evidence?.error && (
        <Alert variant="destructive">
          <AlertDescription>{evidence.error}</AlertDescription>
        </Alert>
      )}
      {evidence?.value && (
        <ul className="flex flex-col gap-2 text-xs">
          {evidence.value.matches.map((match, index) => (
            <li key={index} className="break-words">
              <p>
                {match.field ? humanize(match.field) : "Query condition"} · {match.role}
              </p>
              {match.component && (
                <p className="break-all text-muted-foreground">Component {match.component}</p>
              )}
              {match.condition && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-muted-foreground">Original condition</summary>
                  <pre className="mt-1 whitespace-pre-wrap break-all">{match.condition}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

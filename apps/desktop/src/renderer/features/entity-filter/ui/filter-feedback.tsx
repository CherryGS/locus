import { useSyncExternalStore } from "react"
import { ListFilterIcon } from "lucide-react"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { humanize } from "../model/draft"
import type { FilterCoordinator } from "../model/filter-coordinator"

function indexLabel(c: FilterCoordinator, prefix = "Index ") {
  if (c.statusError) return `Index status unknown: ${c.statusError}`
  const status = c.status
  if (!status) return "Reading index status…"
  const state = humanize(status.state)
  return `${prefix}${state.charAt(0).toUpperCase()}${state.slice(1)}${status.total ? ` · ${status.completed} / ${status.total} Entities` : ""}`
}

function indexDataSize(bytes: string) {
  let value = Number(bytes), unit = 0
  const units = ["bytes", "KiB", "MiB", "GiB", "TiB"]
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`
}

function IndexActions({ coordinator: c, rebuild = false, onAction }: {
  coordinator: FilterCoordinator
  rebuild?: boolean
  onAction?: () => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {c.statusError && <Button size="sm" variant="outline" disabled={c.statusPending} onClick={() => {
        onAction?.()
        void c.readStatus()
      }}>
        Retry status read
      </Button>}
      {!c.statusError && c.status && (!c.status.usable || !!c.status.failure) && (
        <Button size="sm" variant="outline" disabled={!!c.maintenancePending} onClick={() => {
          onAction?.()
          void c.maintain("retry")
        }}>
          Retry indexing
        </Button>
      )}
      {rebuild && (
        <Button size="sm" variant="outline" disabled={!!c.maintenancePending} onClick={() => {
          onAction?.()
          void c.maintain("rebuild")
        }}>
          Rebuild index
        </Button>
      )}
    </div>
  )
}

export function IndexMaintenance({ coordinator: c, onAction }: { coordinator: FilterCoordinator; onAction?: () => void }) {
  const status = !c.statusError ? c.status : undefined
  return (
    <div className="flex flex-wrap items-center justify-between gap-3" aria-label="Search index maintenance">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {status?.document_count != null ? <p className="text-sm tabular-nums select-text" aria-label="Published index statistics">
          {BigInt(status.document_count).toLocaleString()} documents
          {status.segment_bytes != null && ` · ${indexDataSize(status.segment_bytes)}`}
        </p> : null}
        {(!status || status.document_count == null || status.state !== "ready" || status.failure || status.covered_sequence !== status.journal_head) &&
          <p role="status" className="text-xs text-muted-foreground">{status?.state === "ready" && status.covered_sequence !== status.journal_head
            ? "Index updates pending" : indexLabel(c, "")}</p>}
      </div>
      <IndexActions coordinator={c} rebuild onAction={onAction} />
    </div>
  )
}

export function IndexStatus({ coordinator: c }: { coordinator: FilterCoordinator }) {
  const status = c.statusError ? undefined : c.status
  const error = c.statusError || c.maintenanceError || status?.failure
  // Index maintenance never replaces the established result. Refresh is the
  // explicit replacement action; routine lifecycle explanations belong here,
  // while the editor only surfaces a current problem or pending search work.
  const message = c.statusError
    ? indexLabel(c)
    : c.maintenanceError
      ? `Index maintenance failed: ${c.maintenanceError}`
      : status?.failure
        ? `Index update failed: ${status.failure}`
        : c.maintenancePending
          ? `Requesting index ${c.maintenancePending}…`
          : status && (!status.usable || status.state !== "ready")
            ? indexLabel(c)
            : status && status.covered_sequence !== status.journal_head
              ? "Index updates pending"
              : undefined
  if (!message) return null
  return (
    <Alert variant={error ? "destructive" : "default"} aria-label="Search index status">
      <AlertDescription>
        <p role="status">{message}</p>
        <IndexActions coordinator={c} />
      </AlertDescription>
    </Alert>
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
  if (!c.filterApplied && !newer && !c.statusError && !status?.failure &&
      (!status || (status.usable && status.covered_sequence === status.journal_head))) return null
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-4 pb-2 text-xs text-muted-foreground"
      aria-label="Applied Filter result"
    >
      {c.appliedFilter && <>
        <Badge variant="status"><ListFilterIcon aria-hidden="true" />{c.sequence?.length === 0 ? "No matches" : "Filtered result"}</Badge>
        <span className="min-w-0 break-words">{c.appliedFilter.text}</span>
      </>}
      {newer && <span>New index available</span>}
      {status && status.covered_sequence !== status.journal_head && <span>Index updates pending.</span>}
      {status?.failure && <span>Index update failed</span>}
      {c.statusError && <span>Index status unknown.</span>}
      {status && !status.usable && <span>Search unavailable</span>}
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

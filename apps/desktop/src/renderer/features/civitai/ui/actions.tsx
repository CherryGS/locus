import { useSyncExternalStore } from "react"
import type { Wire } from "@/shared/api"
import { CheckIcon, CircleDashedIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Spinner } from "@/shared/ui/spinner"
import type { CivitaiCoordinator } from "../model/coordinator"
export function CivitaiOutcomeDetails({ outcome }: { outcome: Wire<"CivitaiOutcome"> }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge variant="status">
          {outcome.metadata === "accepted" ? <CheckIcon aria-hidden="true" /> : <CircleDashedIcon aria-hidden="true" />}
          Metadata: {outcome.metadata}
        </Badge>
        <Badge variant="status">
          {outcome.state === "complete" ? <CheckIcon aria-hidden="true" /> : <CircleDashedIcon aria-hidden="true" />}
          Whole operation: {outcome.state}
        </Badge>
      </div>
      {outcome.problem && <p>{outcome.problem}</p>}
      {outcome.examples.map((e) => (
        <div key={e.occurrence} className="flex flex-col gap-1">
          <span>
            Example {e.occurrence + 1}: {e.state}
            {e.reused ? " · reused independent target" : ""}
          </span>
          {e.problem && <span>{e.problem}</span>}
          {e.preparations
            .filter((p) => p.file_id !== e.prepared_file)
            .map((p) => (
              <span key={p.file_id}>
                Earlier preparation {p.file_id} · {p.bytes_written} copied bytes ·{" "}
                {p.copy_complete ? "copy complete" : "partial copy"}
                {p.managed_bytes_may_exist ? " · managed bytes retained" : ""}
              </span>
            ))}
          {e.prepared_file && (
            <span>
              File {e.prepared_file}:{" "}
              {e.file_registered
                ? "registered"
                : e.registration_uncertain
                  ? "registration unconfirmed"
                  : "prepared / partial"}
            </span>
          )}
          {e.target_candidate && (
            <span>
              Entity {e.target_candidate}: {e.target_confirmed ? "confirmed" : "provisional; not viewable"}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
export function CivitaiActions({
  coordinator: c,
  entityId,
  fileId,
  firstOnly,
}: {
  coordinator: CivitaiCoordinator
  entityId: string
  fileId?: string
  firstOnly: boolean
}) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  const own = c.operations.filter((o) => o.outcome.entity_id === entityId)
  return (
    <div className="flex flex-col gap-3" aria-label="Origin Civitai operations">
      <Button
        variant="outline"
        disabled={!fileId || !c.available || c.newBlocked(entityId)}
        onClick={() => fileId && void c.submit(entityId, fileId, firstOnly)}
      >
        {firstOnly ? "Enrich this File with Civitai" : "Refresh origin Civitai information"}
      </Button>
      {c.newBlocked(entityId) && (
        <p className="text-sm">
          Original work is active or unconfirmed. Observe or recover that provider operation; imported work
          uses its whole-item import action.
        </p>
      )}
      {c.problem && (
        <Alert>
          <AlertTitle>Provider observation unavailable</AlertTitle>
          <AlertDescription>
            {c.problem}
            <Button variant="outline" size="sm" onClick={() => void c.observe()}>
              Retry operation observation
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {[...c.pending.entries()]
        .filter(([, p]) => p.body.entity_id === entityId)
        .map(([id, p]) => (
          <Alert key={id}>
            <AlertTitle>
              {p.sending ? "Establishing provider admission" : "Submission unconfirmed"}
            </AlertTitle>
            <AlertDescription>
              {p.sending && <Spinner />}
              {p.problem}
              <Button variant="outline" disabled={p.sending} onClick={() => void c.recover(id)}>
                Recover original submission
              </Button>
            </AlertDescription>
          </Alert>
        ))}
      {own.map((o) => (
        <details key={o.operation_id} open={!!o.active_request_id || o.outcome.state !== "complete"}>
          <summary>Origin operation · {o.active_request_id ? "active" : o.outcome.state}</summary>
          <CivitaiOutcomeDetails outcome={o.outcome} />
          {o.observation_problem && <p>{o.observation_problem}</p>}
          {!o.active_request_id && o.outcome.state !== "complete" && (
            <Button
              variant="outline"
              size="sm"
              disabled={!c.available || c.blocked(entityId) || o.unconfirmed_effects}
              onClick={() => void c.submit(entityId, o.outcome.file_id, o.outcome.first_only, o.operation_id)}
            >
              Continue original provider work
            </Button>
          )}
        </details>
      ))}
    </div>
  )
}

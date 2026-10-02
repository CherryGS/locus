import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Button } from "@/shared/ui/button"
import { Spinner } from "@/shared/ui/spinner"
import type { TagCoordinator, TagAttempt } from "../model/tag-coordinator"
import { latestAssignmentAttempts } from "../model/entity-tag-observation"
export function TagFeedback({
  coordinator: c,
  attempts,
  retainAssignmentFailures = false,
  showConfirmed = true,
  showPending = true,
}: {
  coordinator: TagCoordinator
  attempts: TagAttempt[]
  retainAssignmentFailures?: boolean
  showConfirmed?: boolean
  showPending?: boolean
}) {
  const unresolved = attempts.filter((a) => (showPending && a.state === "pending") || a.state === "unconfirmed")
  const latest = attempts.filter((a) => a.state === "failed" || a.state === "confirmed").at(-1)
  const failures = retainAssignmentFailures ? latestAssignmentAttempts(attempts).filter((attempt) => attempt.state === "failed") : []
  const shown = [...unresolved, ...failures, ...(latest && !failures.includes(latest) && (showConfirmed || latest.state !== "confirmed") ? [latest] : [])]
  if (!shown.length) return null
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {shown.map((a) =>
        a.state === "confirmed" ? (
          <p key={a.request} role="status" className="break-words text-xs text-muted-foreground">
            {a.label}: {a.message}
          </p>
        ) : (
          <Alert key={a.request} variant={a.state === "failed" ? "destructive" : "default"}>
            <AlertDescription>
              <span className="break-words">
                {a.label}: {a.message}
              </span>
              {a.state === "pending" && <Spinner />}
              {a.state === "unconfirmed" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={a.recovering}
                  onClick={() => void c.recover(a)}
                >
                  {a.recovering && <Spinner />}Recover original request
                </Button>
              )}
              {a.uncertain && (
                <p>Current reads can reconcile what exists, but do not prove this original commit.</p>
              )}
            </AlertDescription>
          </Alert>
        ),
      )}
    </div>
  )
}

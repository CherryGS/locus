import { TriangleAlertIcon } from "lucide-react"
import type { ReadProblem } from "@/entities/entity"
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"

const recoveryLabels = {
  entity: ["Metadata unavailable", "Reread Entity"],
  resource: ["Preview unavailable", "Retry image"],
  "preference-read": ["Saved view unavailable", "Retry preference read"],
  "preference-save": ["View not saved", "Retry saving"],
  "preference-check": ["Saving not confirmed", "Check saving"],
} as const

export function EntityProblems({
  problems,
  recover,
}: {
  problems: readonly ReadProblem[]
  recover: (problem: ReadProblem) => void
}) {
  return (
    <section aria-label="Entity problems" className="flex min-w-0 flex-col gap-3 px-4 py-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        Needs attention <Badge variant="destructive">{problems.length}</Badge>
      </h3>
      {problems.map((problem) => {
        const [title, action] = recoveryLabels[problem.recovery]
        return (
          <Alert key={problem.key} className="has-[>svg]:grid-cols-[auto_minmax(0,1fr)]">
            <TriangleAlertIcon className="text-destructive" />
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription className="flex min-w-0 flex-col gap-3 [&_p:not(:last-child)]:mb-0">
              <p className="text-foreground [overflow-wrap:anywhere]">{problem.message}</p>
              {problem.previous && <p>Displayed facts are from the previous successful observation.</p>}
              <Button variant="outline" size="xs" className="h-auto min-h-7 max-w-full self-start whitespace-normal py-1 text-left" onClick={() => recover(problem)}>
                {action}
              </Button>
              <div className="flex min-w-0 flex-col gap-1 border-t pt-3 text-xs">
                <p className="font-medium">Affected data</p>
                <p className="break-all select-text">{problem.subject}</p>
              </div>
            </AlertDescription>
          </Alert>
        )
      })}
    </section>
  )
}

import { useEffect, useSyncExternalStore } from "react"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import type { FilterCoordinator } from "../model/filter-coordinator"
import { IndexMaintenance } from "./filter-feedback"

export function SearchIndexSettings({ coordinator: c }: { coordinator: FilterCoordinator }) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  useEffect(() => { void c.readStatus() }, [c])
  return (
    <section aria-label="Search index" className="flex min-w-0 flex-col gap-2">
      <h2 className="text-sm font-medium">Search index</h2>
      <details className="rounded-xl border border-border/70 bg-card p-4">
        <summary className="cursor-pointer text-sm">Advanced maintenance</summary>
        <div className="mt-3 flex flex-col gap-3">
          <IndexMaintenance coordinator={c} />
          {(c.maintenanceError || c.status?.failure) && <Alert variant="destructive">
            <AlertDescription>{c.maintenanceError ?? c.status?.failure}</AlertDescription>
          </Alert>}
        </div>
      </details>
    </section>
  )
}

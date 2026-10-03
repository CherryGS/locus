import { useEffect, useSyncExternalStore } from "react"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { CircleHelpIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/shared/ui/popover"
import type { FilterCoordinator } from "../model/filter-coordinator"
import { IndexMaintenance } from "./filter-feedback"

export function SearchIndexSettings({ coordinator: c }: { coordinator: FilterCoordinator }) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  useEffect(() => { void c.readStatus() }, [c])
  return (
    <section aria-label="Search index" className="flex min-w-0 flex-col gap-2">
      <header className="flex min-h-8 items-center gap-1">
        <h2 className="text-sm font-medium">Search index</h2>
        <Popover>
          <PopoverTrigger aria-label="About index statistics" render={<Button variant="ghost" size="icon-sm" />}>
            <CircleHelpIcon />
          </PopoverTrigger>
          <PopoverContent>
            <PopoverTitle>Index statistics</PopoverTitle>
            <p>Documents and searchable segment data in the published index. Size excludes library media, index metadata and older retained generations.</p>
          </PopoverContent>
        </Popover>
      </header>
      <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card px-4 py-3">
        <IndexMaintenance coordinator={c} />
        {(c.maintenanceError || c.status?.failure) && <Alert variant="destructive">
          <AlertDescription>{c.maintenanceError ?? c.status?.failure}</AlertDescription>
        </Alert>}
      </div>
    </section>
  )
}

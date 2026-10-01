import { useLayoutEffect, useRef, useState } from "react"
import { EllipsisIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Field, FieldLabel } from "@/shared/ui/field"
import { Input } from "@/shared/ui/input"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/shared/ui/popover"
import { Separator } from "@/shared/ui/separator"
import type { FilterCoordinator } from "../model/filter-coordinator"
import { IndexMaintenance } from "./filter-feedback"

type Action = "rename" | "delete"

export function PresetOptions({
  coordinator: c,
  onAction,
}: {
  coordinator: FilterCoordinator
  onAction: (action: Action) => void
}) {
  const [open, setOpen] = useState(false)
  const pending = useRef<Action | undefined>(undefined)
  useLayoutEffect(() => {
    if (!c.open) {
      pending.current = undefined
      setOpen(false)
    }
  }, [c.open])
  const choose = (action: Action) => {
    pending.current = action
    setOpen(false)
  }
  return (
    <Popover
      open={open && c.open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(visible) => {
        if (visible || !pending.current) return
        const action = pending.current
        pending.current = undefined
        // Let the popover restore focus before opening the naming dialog.
        if (c.open) onAction(action)
      }}
    >
      <PopoverTrigger
        aria-label="Filter options"
        disabled={c.busy}
        render={<Button variant="ghost" size="icon" />}
      >
        <EllipsisIcon />
      </PopoverTrigger>
      <PopoverContent align="end">
        <PopoverTitle>Filter options</PopoverTitle>
        <Field>
          <FieldLabel htmlFor="filter-name">Preset name</FieldLabel>
          <Input
            id="filter-name"
            value={c.draft.name}
            disabled={c.busy}
            onChange={(event) => c.edit({ ...c.draft, name: event.target.value })}
            placeholder="Name this query…"
          />
        </Field>
        <Separator />
        <div className="flex flex-col gap-1">
          <Button variant="ghost" className="justify-start" disabled={!c.saved || c.busy} onClick={() => choose("rename")}>
            Rename
          </Button>
          <Button variant="ghost" className="justify-start" disabled={!c.saved || c.busy} onClick={() => choose("delete")}>
            Delete preset
          </Button>
        </div>
        <Separator />
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">Search index</summary>
          <div className="mt-2"><IndexMaintenance coordinator={c} onAction={() => setOpen(false)} /></div>
        </details>
      </PopoverContent>
    </Popover>
  )
}

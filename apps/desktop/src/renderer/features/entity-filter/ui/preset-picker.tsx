import { useLayoutEffect, useRef, useState } from "react"
import { BookmarkIcon, CheckIcon, SearchIcon } from "lucide-react"
import type { Wire } from "@/shared/api"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Button } from "@/shared/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/ui/empty"
import { Field, FieldLabel } from "@/shared/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/shared/ui/input-group"
import { Spinner } from "@/shared/ui/spinner"

type Preset = Wire<"FilterPresetSummary">

export function PresetPicker({
  presets,
  selected,
  disabled,
  loading,
  active,
  error,
  onRetry,
  onSelect,
}: {
  presets?: Preset[]
  selected?: Preset
  disabled: boolean
  loading: boolean
  active: boolean
  error?: string
  onRetry: () => void
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("")
  const entry = useRef<HTMLButtonElement>(null),
    pending = useRef<string | undefined>(undefined),
    selecting = useRef(false),
    wasLoading = useRef(loading)
  useLayoutEffect(() => {
    if (wasLoading.current && !loading && active) entry.current?.focus()
    wasLoading.current = loading
  }, [loading, active])
  useLayoutEffect(() => {
    if (!active) {
      setOpen(false)
      pending.current = undefined
    }
  }, [active])
  const matches = presets?.filter((preset) =>
    preset.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )
  return (
    <Dialog
      open={open && active}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setQuery("")
          pending.current = undefined
          selecting.current = false
        }
      }}
      onOpenChangeComplete={(visible) => {
        const id = pending.current
        if (visible || !id) return
        pending.current = undefined
        if (active) {
          // Restore focus before a possible unsaved-edit dialog opens.
          entry.current?.focus()
          onSelect(id)
        }
      }}
    >
      <Field className="min-w-48 flex-1">
        <FieldLabel htmlFor="filter-preset">Load preset</FieldLabel>
        <DialogTrigger
          ref={entry}
          id="filter-preset"
          aria-label="Load preset"
          title={selected?.name}
          disabled={disabled}
          render={<Button variant="outline" className="w-full min-w-0 justify-start" />}
        >
          <BookmarkIcon data-icon="inline-start" />
          <span className="min-w-0 flex-1 truncate text-left">
            {selected?.name ?? "Choose a preset…"}
          </span>
        </DialogTrigger>
      </Field>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg"
        finalFocus={() => (selecting.current || !active ? false : entry.current)}
      >
        <DialogHeader>
          <DialogTitle>Choose a preset</DialogTitle>
          <DialogDescription>Load a saved query into the editor.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="filter-preset-search" className="sr-only">
            Search presets
          </FieldLabel>
          <InputGroup>
            <InputGroupAddon align="inline-start"><SearchIcon /></InputGroupAddon>
            <InputGroupInput
              id="filter-preset-search"
              placeholder="Search by name…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
        </Field>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error}
              <Button variant="outline" size="sm" onClick={onRetry}>Retry presets</Button>
            </AlertDescription>
          </Alert>
        )}
        <div className="min-h-0 overflow-y-auto">
          {!presets && !error ? (
            <p role="status" className="flex items-center justify-center gap-2 py-6">
              <Spinner />Loading presets…
            </p>
          ) : matches?.length ? (
            <ul aria-label="Saved presets" className="flex max-h-64 flex-col gap-1">
              {matches.map((preset) => (
                <li key={preset.id}>
                  <Button
                    variant={preset.id === selected?.id ? "secondary" : "ghost"}
                    className="h-auto min-h-10 w-full justify-start py-2"
                    aria-label={"Load " + preset.name}
                    onClick={() => {
                      pending.current = preset.id
                      selecting.current = true
                      setOpen(false)
                    }}
                  >
                    <span className="min-w-0 flex-1 whitespace-normal text-left wrap-anywhere">
                      {preset.name}
                    </span>
                    {preset.id === selected?.id && (
                      <CheckIcon data-icon="inline-end" aria-label="Current preset" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          ) : presets && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {presets.length === 0 ? "No saved presets yet" : "No matching presets"}
                </EmptyTitle>
                <EmptyDescription>
                  {presets.length === 0 ? "Name your query and save it in Filter." : "Try another name."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

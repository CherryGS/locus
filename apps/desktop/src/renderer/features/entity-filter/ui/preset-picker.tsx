import { useLayoutEffect, useRef, useState } from "react"
import { BookmarkIcon, CheckIcon, PencilIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react"
import type { Wire } from "@/shared/api"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Button } from "@/shared/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/ui/empty"
import { Field, FieldLabel } from "@/shared/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/shared/ui/input-group"
import { Spinner } from "@/shared/ui/spinner"

type Preset = Wire<"FilterPresetSummary">

export function PresetPicker({
  open,
  onOpenChange: setOpen,
  restoreFocus,
  presets,
  selected,
  disabled,
  loading,
  active,
  error,
  onRetry,
  onSelect,
  onManage,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  restoreFocus: boolean
  presets?: Preset[]
  selected?: Preset
  disabled: boolean
  loading: boolean
  active: boolean
  error?: string
  onRetry: () => void
  onSelect: (id: string) => void
  onManage: (preset: Preset, action: "rename" | "delete") => void
}) {
  const [query, setQuery] = useState("")
  const entry = useRef<HTMLButtonElement>(null),
    pending = useRef<{ id: string } | { preset: Preset; action: "rename" | "delete" } | undefined>(undefined),
    selecting = useRef(false),
    dismissedOutside = useRef(false),
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
      modal={false}
      open={open && active}
      onOpenChange={(next, details) => {
        dismissedOutside.current = details.reason === "outside-press" || details.reason === "focus-out"
        setOpen(next)
        if (next) {
          setQuery("")
          pending.current = undefined
          selecting.current = false
        }
      }}
      onOpenChangeComplete={(visible) => {
        const intent = pending.current
        if (visible || !intent) return
        pending.current = undefined
        if (active) {
          // Restore focus before a possible unsaved-edit dialog opens.
          entry.current?.focus()
          if ("id" in intent) onSelect(intent.id)
          else onManage(intent.preset, intent.action)
        }
      }}
    >
      <Field className="min-w-0 flex-1">
        <FieldLabel htmlFor="filter-preset" className="sr-only">Load preset</FieldLabel>
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
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg"
        finalFocus={() => (selecting.current || dismissedOutside.current || !active || !restoreFocus ? false : entry.current)}
      >
        <DialogTitle className="sr-only">Choose a preset</DialogTitle>
        <DialogDescription className="sr-only">Load a saved query into the editor.</DialogDescription>
        <div className="flex items-center gap-2">
          <Field className="min-w-0 flex-1">
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
          <DialogClose render={<Button variant="ghost" size="icon" />}>
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogClose>
        </div>
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
                <li key={preset.id} className="flex min-w-0 items-center gap-1">
                  <Button
                    variant={preset.id === selected?.id ? "secondary" : "ghost"}
                    className="h-auto min-h-10 min-w-0 flex-1 justify-start py-2"
                    disabled={disabled}
                    aria-label={"Load " + preset.name}
                    onClick={() => {
                      pending.current = { id: preset.id }
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
                  {(["rename", "delete"] as const).map(action => (
                    <Button key={action} variant="ghost" size="icon-sm" disabled={disabled}
                      aria-label={`${action === "rename" ? "Rename" : "Delete"} preset ${preset.name}`}
                      title={action === "rename" ? "Rename preset" : "Delete preset"}
                      onClick={() => {
                        pending.current = { preset, action }
                        selecting.current = true
                        setOpen(false)
                      }}>
                      {action === "rename" ? <PencilIcon /> : <Trash2Icon />}
                    </Button>
                  ))}
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
      </DialogContent>
    </Dialog>
  )
}

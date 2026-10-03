import type { ReactNode, ComponentProps } from "react"
import { CircleHelpIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Field, FieldContent, FieldLabel, FieldError } from "@/shared/ui/field"
import { Input } from "@/shared/ui/input"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/shared/ui/popover"

export function SettingsGroup({
  name,
  help,
  status,
  action,
  children,
}: {
  name: string
  help?: { label: string; content: ReactNode }
  status?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      role="region"
      aria-label={name}
      className="@container/settings flex min-w-0 flex-col gap-2"
    >
      <header className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1">
            <h2 className="text-sm font-medium">{name}</h2>
            {help && (
              <Popover>
                <PopoverTrigger
                  render={<Button type="button" variant="ghost" size="icon-sm" />}
                  aria-label={help.label}
                >
                  <CircleHelpIcon aria-hidden="true" />
                </PopoverTrigger>
                <PopoverContent align="start" className="gap-3">
                  <PopoverTitle>{name}</PopoverTitle>
                  {help.content}
                </PopoverContent>
              </Popover>
            )}
          </div>
          {status && <div className="flex flex-wrap items-center gap-2">{status}</div>}
        </div>
        {action && <div className="flex items-center gap-1">{action}</div>}
      </header>
      <div className="rounded-xl border border-border/70 bg-card">{children}</div>
    </section>
  )
}

// Read-only facts and editable fields share the same columns and responsive break.
const rowClassName =
  "grid min-h-14 grid-cols-1 items-start gap-x-6 gap-y-2 px-4 py-3 @min-[32rem]/settings:grid-cols-[9rem_minmax(0,1fr)]"
const labelClassName = "text-sm font-normal @min-[32rem]/settings:pt-1.5"

export function SettingsRow({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className={rowClassName}>
      {htmlFor ? (
        <FieldLabel htmlFor={htmlFor} className={labelClassName}>
          {label}
        </FieldLabel>
      ) : (
        <p className={labelClassName}>{label}</p>
      )}
      <div className="flex min-w-0 flex-col gap-2 text-sm select-text">{children}</div>
    </div>
  )
}

export function SettingsEditRow({
  label,
  error,
  children,
  ...input
}: ComponentProps<typeof Input> & {
  id: string
  label: string
  error?: string
  children?: ReactNode
}) {
  const describedBy =
    [input["aria-describedby"], error && `${input.id}-error`].filter(Boolean).join(" ") || undefined
  return (
    <Field data-invalid={!!error} data-disabled={input.disabled} className={rowClassName}>
      <FieldLabel htmlFor={input.id} className={labelClassName}>
        {label}
      </FieldLabel>
      <FieldContent className="min-w-0 gap-2">
        <Input
          {...input}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          spellCheck={false}
          autoComplete="off"
        />
        {error && <FieldError id={`${input.id}-error`}>{error}</FieldError>}
        {children}
      </FieldContent>
    </Field>
  )
}

export function SettingsActions({
  notice,
  status,
  children,
}: {
  notice?: string
  status?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex min-h-8 flex-wrap items-center justify-end gap-2 pt-3">
      <div className="mr-auto flex flex-wrap items-center gap-2">
        {notice && <span className="text-xs text-muted-foreground">{notice}</span>}
        {status}
      </div>
      {children}
    </div>
  )
}

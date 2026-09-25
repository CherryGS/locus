import type { ReactNode, ComponentProps } from "react"
import { Field, FieldContent, FieldLabel, FieldError } from "@/shared/ui/field"
import { Input } from "@/shared/ui/input"

export function SettingsGroup({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section aria-label={name} className="shrink-0 overflow-hidden rounded-lg border bg-card">
      {children}
    </section>
  )
}
export function IconTile({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded bg-muted/60 text-muted-foreground [&>svg]:size-3.5"
    >
      {children}
    </span>
  )
}
export function SettingsRow({
  icon,
  label,
  hint,
  children,
}: {
  icon: ReactNode
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <IconTile>{icon}</IconTile>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm">{label}</p>
          {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
        </div>
      </div>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}
export function SettingsEditRow({
  icon,
  label,
  hint,
  error,
  ...input
}: ComponentProps<typeof Input> & { icon: ReactNode; label: string; hint: string; error?: string }) {
  return (
    <Field
      orientation="responsive"
      data-invalid={!!error}
      data-disabled={input.disabled}
      className="min-h-16 items-center gap-4 px-4 py-3"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <IconTile>{icon}</IconTile>
        <FieldContent>
          <FieldLabel htmlFor={input.id}>{label}</FieldLabel>
          <p id={`${input.id}-help`} className="text-xs leading-relaxed text-muted-foreground">
            {hint}
          </p>
          {error && <FieldError>{error}</FieldError>}
        </FieldContent>
      </div>
      <Input
        {...input}
        aria-invalid={!!error}
        aria-describedby={`${input.id}-help`}
        className="max-w-full @md/field-group:w-56 @md/field-group:shrink-0"
        spellCheck={false}
        autoComplete="off"
      />
    </Field>
  )
}

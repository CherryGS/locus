export function FieldReferenceRow({ label, value, type, description }: {
  label: string
  value: string
  type: string
  description: string
}) {
  return (
    <div
      data-field-reference-row={label}
      title={`${value} · ${description}`}
      className="grid min-h-6 min-w-0 grid-cols-[minmax(0,1fr)_4.5rem] items-baseline gap-2 select-text"
    >
      <code className="min-w-0 break-all text-xs leading-6 font-normal">{value}</code>
      <span className="text-right text-xs leading-6 text-muted-foreground">{type}</span>
    </div>
  )
}

import type { ReactNode } from "react"

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="-mx-1 grid min-h-7 min-w-0 grid-cols-[clamp(4.5rem,36%,5rem)_minmax(0,1fr)] items-baseline gap-3 rounded-md px-1 py-1 transition-colors hover:bg-muted/30">
      <dt className="text-xs leading-5 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-xs leading-5 tabular-nums select-text [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2 px-4 py-3">
      <h3 className="text-xs font-semibold">{title}</h3>
      {children}
    </section>
  )
}

export function DetailTime({ value }: { value: string }) {
  const date = new Date(value)
  return (
    <time dateTime={value} title={date.toLocaleString(undefined, { timeZoneName: "short" })}>
      <span className="block">{date.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" })}</span>
      <span className="block text-[11px] leading-4 text-muted-foreground">{date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span>
    </time>
  )
}

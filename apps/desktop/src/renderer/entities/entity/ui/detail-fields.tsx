import type { ReactNode } from "react"
import { ChevronRightIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible"
import { CopyIdentityButton } from "@/shared/ui/copy-identity-button"
import { formatDurationMilliseconds, unixMillisecondsIso } from "../lib/format-metadata"

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-h-8 min-w-0 grid-cols-1 items-baseline gap-x-3 gap-y-0.5 py-1.5 @min-[14rem]/detail:grid-cols-[clamp(4.5rem,36%,5.5rem)_minmax(0,1fr)]">
      <dt className="text-xs leading-5 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-xs leading-5 tabular-nums select-text [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  )
}

export function DetailSection({
  title,
  children,
  collapsible = false,
  summary,
}: {
  title: string
  children: ReactNode
  collapsible?: boolean
  summary?: ReactNode
}) {
  return (
    <section aria-label={title} className="@container/detail flex min-w-0 flex-col gap-3 px-4 py-4">
      {collapsible ? (
        <Collapsible>
          <h3>
            <CollapsibleTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal px-0 py-0 text-left"
                />
              }
              className="group"
            >
              <ChevronRightIcon
                data-icon="inline-start"
                className="shrink-0 group-data-open:rotate-90"
              />
              <span className="min-w-0 flex-1">{title}</span>
            </CollapsibleTrigger>
          </h3>
          {summary && <p className="mt-2 text-xs text-muted-foreground">{summary}</p>}
          <CollapsibleContent>
            <div className="flex min-w-0 flex-col gap-3 pt-3">{children}</div>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <>
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {title}
          </h3>
          {children}
        </>
      )}
    </section>
  )
}

export function DetailIdentifier({ label, value }: { label: string; value: string }) {
  if (value === "") return <span className="text-muted-foreground">None</span>
  return <CopyIdentityButton key={value} label={label} value={value} />
}

export function DetailDurationMilliseconds({ value }: { value: string | number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground">Not captured</span>
  return <span title={`${value} ms`}>{formatDurationMilliseconds(value) ?? String(value)}</span>
}

export function DetailUnixTime({ value }: { value: string | number | null | undefined }) {
  if (value == null) return <span className="text-muted-foreground">Not captured</span>
  const iso = unixMillisecondsIso(value)
  return iso ? (
    <DetailTime value={iso} exactValue={`${value} ms since Unix epoch`} />
  ) : (
    <span>{value}</span>
  )
}

export function DetailTime({ value, exactValue = value }: { value: string; exactValue?: string }) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return <span>{value}</span>
  return (
    <time
      dateTime={value}
      title={`${date.toLocaleString(undefined, { timeZoneName: "short" })} · ${exactValue}`}
    >
      <span className="block">
        {date.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" })}
      </span>
      <span className="block text-[11px] leading-4 text-muted-foreground">
        {date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}
      </span>
    </time>
  )
}

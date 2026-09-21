import type { ReactNode } from "react"
import type { EntityComponent } from "../model/entity-item"

export type TwitterComponent = Extract<EntityComponent, { kind: "twitter" }>

export const twitterReferenceLabels = {
  reply: "Reply to",
  quote: "Quote",
  repost: "Repost",
} as const

export function CapturedText({ value, empty = "None" }: { value: string | undefined; empty?: string }) {
  if (value === undefined) return <span className="text-muted-foreground">Not captured</span>
  if (value === "") return <span className="text-muted-foreground">{empty}</span>
  return <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{value}</span>
}

export function SourceLink({ url, children }: { url: string | undefined; children?: ReactNode }) {
  if (!url) return <CapturedText value={url} />
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={url} className="rounded-sm underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]">
      {children ?? url}
    </a>
  )
}

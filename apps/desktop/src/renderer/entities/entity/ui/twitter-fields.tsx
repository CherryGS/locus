import { useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "@/shared/ui/toast"
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
  // Key the action by target and unmount it with its component/Entity view.
  return <SourceLinkAction key={url} url={url}>{children}</SourceLinkAction>
}
function SourceLinkAction({ url, children }: { url: string | undefined; children?: ReactNode }) {
  const [pending, setPending] = useState(false)
  const attempt = useRef(0)
  const feedback = useRef<string | undefined>(undefined)
  const dismissFeedback = () => {
    if (feedback.current) toast.close(feedback.current)
    feedback.current = undefined
  }
  useEffect(() => () => {
    attempt.current++
    // Feedback belongs to this link and must leave with its Entity or view.
    if (feedback.current) toast.close(feedback.current)
  }, [])
  const showFailure = (message: string) => {
    feedback.current = toast.add({
      title: "Couldn't open link",
      description: message,
      type: "error",
      actionProps: {
        children: "Retry",
        "aria-label": "Retry opening link",
        onClick: () => { void open() },
      },
    })
  }
  const open = async () => {
    if (!url || pending) return
    const current = ++attempt.current
    dismissFeedback()
    setPending(true)
    try {
      const result = await window.locusDesktop!.openExternalLink(url)
      if (current !== attempt.current) return
      if (result.url !== url) showFailure("The browser handoff returned a different target.")
      else if (result.status === "failed") showFailure(result.message ?? "The system browser handoff failed.")
    } catch {
      if (current === attempt.current) showFailure("The system browser handoff could not be completed.")
    } finally {
      if (current === attempt.current) setPending(false)
    }
  }
  if (!url) return <CapturedText value={url} />
  // Browser-only specimens retain normal anchor behavior. Live verification installs
  // an explicit preview bridge that reports its inability to perform native handoff.
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={url}
      aria-busy={pending}
      onClick={event => { if (window.locusDesktop) { event.preventDefault(); void open() } }}
      onAuxClick={event => { if (window.locusDesktop && event.button === 1) { event.preventDefault(); void open() } }}
      className="rounded-sm underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]">
      {children ?? url}
    </a>
  )
}

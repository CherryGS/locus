import { useEffect, useRef, useState, type ReactNode } from "react"
import { Button } from "@/shared/ui/button"

export function CapturedText({ value, empty = "None" }: { value: string | undefined; empty?: string }) {
  if (value === undefined) return <span className="text-muted-foreground">Not captured</span>
  if (value === "") return <span className="text-muted-foreground">{empty}</span>
  return <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">{value}</span>
}

export function SourceLink({ url, children }: { url: string | undefined; children?: ReactNode }) {
  // Key the action by target and unmount it with its component/Entity view.
  return (
    <SourceLinkAction key={url} url={url}>
      {children}
    </SourceLinkAction>
  )
}
function SourceLinkAction({ url, children }: { url: string | undefined; children?: ReactNode }) {
  const [failure, setFailure] = useState<string>()
  const [pending, setPending] = useState(false)
  const attempt = useRef(0)
  useEffect(
    () => () => {
      attempt.current++
    },
    [],
  )
  const open = async () => {
    if (!url || pending) return
    const current = ++attempt.current
    setPending(true)
    try {
      const result = await window.locusDesktop!.openExternalLink(url)
      if (current !== attempt.current) return
      setFailure(
        result.url !== url
          ? "The browser handoff returned a different target."
          : result.status === "failed"
            ? (result.message ?? "The system browser handoff failed.")
            : undefined,
      )
    } catch {
      if (current === attempt.current) setFailure("The system browser handoff could not be completed.")
    } finally {
      if (current === attempt.current) setPending(false)
    }
  }
  if (!url) return <CapturedText value={url} />
  // Browser-only specimens retain normal anchor behavior. Live verification installs
  // an explicit preview bridge that reports its inability to perform native handoff.
  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={url}
        aria-busy={pending}
        onClick={(event) => {
          if (window.locusDesktop) {
            event.preventDefault()
            void open()
          }
        }}
        onAuxClick={(event) => {
          if (window.locusDesktop && event.button === 1) {
            event.preventDefault()
            void open()
          }
        }}
        className="rounded-sm underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-ring [overflow-wrap:anywhere]"
      >
        {children ?? url}
      </a>
      {failure && (
        <span
          role="status"
          className="flex max-w-full flex-col items-start gap-1 text-xs text-muted-foreground"
        >
          <span>{failure}</span>
          <span className="select-text [overflow-wrap:anywhere]">{url}</span>
          <Button variant="outline" size="xs" disabled={pending} onClick={() => void open()}>
            Retry opening link
          </Button>
        </span>
      )}
    </span>
  )
}

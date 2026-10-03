import { useEffect, useState } from "react"
import { Button } from "@/shared/ui/button"
import { CheckIcon, CopyIcon } from "lucide-react"
import { cn } from "@/shared/lib/utils"

export function CopyIdentityButton({ label, value }: { label: string; value: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle")

  useEffect(() => {
    if (status === "idle") return
    const timeout = window.setTimeout(() => setStatus("idle"), 2000)
    return () => window.clearTimeout(timeout)
  }, [status])

  async function copy() {
    setStatus("idle")
    try {
      await navigator.clipboard.writeText(value)
      setStatus("copied")
    } catch {
      setStatus("failed")
    }
  }

  const feedback =
    status === "copied"
      ? `${label} copied.`
      : status === "failed"
        ? `Could not copy ${label.toLowerCase()}.`
        : ""

  return (
    <>
      <Button
        variant={status === "failed" ? "destructive" : "ghost"}
        size="xs"
        className="-mx-1.5 h-auto min-h-7 w-[calc(100%+0.75rem)] min-w-0 shrink flex-1 items-center justify-start gap-2 px-1.5 py-1 whitespace-normal"
        aria-label={`Copy ${label.toLowerCase()}`}
        title={`Copy ${label.toLowerCase()}: ${value}`}
        onClick={copy}
      >
        <code className="min-w-0 flex-1 break-all text-left font-mono text-foreground">
          {value}
        </code>
        <span
          aria-hidden="true"
          className={cn(
            "flex shrink-0 items-center",
            status === "idle" &&
              "opacity-0 group-hover/button:opacity-100 group-focus-visible/button:opacity-100 [@media(hover:none)]:opacity-100",
          )}
        >
          {status === "copied" ? <CheckIcon data-icon="inline-end" /> : <CopyIcon data-icon="inline-end" />}
        </span>
      </Button>
      <span role="status" className="sr-only">
        {feedback}
      </span>
    </>
  )
}

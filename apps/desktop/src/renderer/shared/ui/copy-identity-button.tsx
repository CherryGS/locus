import { useEffect, useState } from "react"
import { Button } from "@/shared/ui/button"
import { CheckIcon, CopyIcon } from "lucide-react"

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
        className="h-auto w-full min-w-0 shrink flex-1 items-start justify-start gap-2 px-0 py-1 whitespace-normal"
        aria-label={`Copy ${label.toLowerCase()}`}
        title={value}
        onClick={copy}
      >
        <code className="min-w-0 flex-1 break-all text-left font-mono text-muted-foreground">
          {value}
        </code>
        {status === "copied" ? <CheckIcon data-icon="inline-end" /> : <CopyIcon data-icon="inline-end" />}
      </Button>
      <span role="status" className="sr-only">
        {feedback}
      </span>
    </>
  )
}

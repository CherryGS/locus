import { useEffect, useState } from "react"
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/shared/ui/button"

export function FieldReferenceRow({ label, value, type, description }: {
  label: string
  value: string
  type: string
  description: string
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle")
  useEffect(() => {
    if (status === "idle") return
    const timeout = window.setTimeout(() => setStatus("idle"), 2000)
    return () => window.clearTimeout(timeout)
  }, [status])
  return (
    <>
      <Button
        variant={status === "failed" ? "destructive" : "ghost"}
        size="xs"
        className="group/field-copy grid h-auto min-h-6 w-full min-w-0 grid-cols-[minmax(0,1fr)_4.5rem_1.5rem] items-start gap-2 px-1 py-0.5 whitespace-normal"
        aria-label={`Copy ${label}`}
        title={`${value} · ${description}`}
        onClick={async () => {
          setStatus("idle")
          try {
            await navigator.clipboard.writeText(value)
            setStatus("copied")
          } catch {
            setStatus("failed")
          }
        }}
      >
        <code className="min-w-0 break-all text-left text-xs">{value}</code>
        <span className="text-right text-xs text-muted-foreground">{type}</span>
        <span
          aria-hidden="true"
          className={cn(
            "flex justify-end opacity-0 transition-opacity group-hover/field-copy:opacity-100 group-focus-visible/field-copy:opacity-100 [@media(hover:none)]:opacity-100",
            status !== "idle" && "opacity-100",
          )}
        >
          {status === "copied" ? <CheckIcon data-icon="inline-end" />
            : status === "failed" ? <TriangleAlertIcon data-icon="inline-end" />
              : <CopyIcon data-icon="inline-end" />}
        </span>
      </Button>
      <span role="status" className="sr-only">
        {status === "copied" ? `${label} copied.` : status === "failed" ? `Could not copy ${label}.` : ""}
      </span>
    </>
  )
}

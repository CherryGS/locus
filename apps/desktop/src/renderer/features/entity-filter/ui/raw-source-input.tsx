import { useEffect, useRef } from "react"
import { cn } from "cn"
import type { Wire } from "@/shared/api"
import { Textarea } from "@/shared/ui/textarea"
import { diagnosticPosition, displaySource, editSource } from "../model/raw-input"

type Props = {
  source: Wire<"FilterSource">
  analysis?: Wire<"FilterAnalysis">
  disabled: boolean
  change: (text: string) => void
  reveal?: number
  expanded?: boolean
}
export function RawSourceInput({ source, analysis, disabled, change, reveal, expanded }: Props) {
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (reveal === undefined || !input.current) return
    const position = diagnosticPosition(source.text, reveal)
    input.current.focus()
    input.current.setSelectionRange(position, position)
  }, [reveal, source.text])
  return (
    <Textarea
      id="filter-source"
      ref={input}
      aria-label="Filter source"
      placeholder="Enter a query…"
      spellCheck={false}
      aria-invalid={analysis?.state === "invalid"}
      disabled={disabled}
      className={cn("filter-source min-h-32 max-h-64 resize-y", expanded && "sm:min-h-[clamp(8rem,30dvh,14rem)]")}
      value={displaySource(source.text)}
      onChange={(event) => change(editSource(source.text, event.target.value))}
    />
  )
}

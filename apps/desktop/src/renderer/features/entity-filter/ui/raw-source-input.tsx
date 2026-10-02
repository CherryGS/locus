import { useEffect, useRef, type RefObject } from "react"
import type { Wire } from "@/shared/api"
import { Textarea } from "@/shared/ui/textarea"
import { diagnosticPosition, displaySource, editSource, rawPosition } from "../model/raw-input"
import type { FilterAssistance } from "../model/assistance"
import { AssistanceScope } from "./assistance-scope"

type Props = {
  source: Wire<"FilterSource">
  analysis?: Wire<"FilterAnalysis">
  disabled: boolean
  reveal?: number
  assistance: FilterAssistance
  inputRef: RefObject<HTMLTextAreaElement | null>
}
export function RawSourceInput({ source, analysis, disabled, reveal, assistance: a, inputRef: input }: Props) {
  const before = useRef<{ direct: boolean; start: number; end: number } | undefined>(undefined)
  const composing = useRef(false)
  useEffect(() => {
    const element = input.current
    if (!element) return
    const record = (event: InputEvent) => {
      before.current = { direct: event.inputType === "insertText" && event.data === "@" && !event.isComposing && !composing.current,
        start: element.selectionStart, end: element.selectionEnd }
    }
    element.addEventListener("beforeinput", record)
    return () => element.removeEventListener("beforeinput", record)
  }, [])
  useEffect(() => {
    if (!a.selection || !input.current) return
    if (!a.lookupFocused || !a.lookupAvailable) input.current.focus()
    input.current.setSelectionRange(a.selection.position, a.selection.position)
  }, [a.selection, a.lookupAvailable])
  useEffect(() => {
    if (reveal === undefined || !input.current) return
    const position = diagnosticPosition(source.text, reveal)
    input.current.focus()
    input.current.setSelectionRange(position, position)
  }, [reveal, source.text])
  return (
    <div className="relative">
      <Textarea
        id="filter-source"
        ref={input}
        aria-label="Filter source"
        placeholder="Enter a query…"
        spellCheck={false}
        aria-invalid={analysis?.state === "invalid"}
        disabled={disabled}
        className="filter-source min-h-32 max-h-64 resize-y"
        value={displaySource(source.text)}
        aria-describedby={a.active ? "filter-assistance-hint" : undefined}
        aria-controls={a.active ? "filter-assistance" : undefined}
        onFocus={() => { a.lookupFocused = false }}
        onPointerDown={() => { if (a.session) a.session.lookupRequested = false }}
        onPaste={() => { before.current = undefined }}
        onCompositionStart={() => { composing.current = true; before.current = undefined }}
        onCompositionEnd={() => { composing.current = false }}
        onChange={(event) => {
          const text = editSource(source.text, event.target.value), typed = before.current
          before.current = undefined
          const marker = typed?.direct && typed.start === typed.end && !a.active &&
            event.target.value.slice(typed.start, typed.start + 1) === "@"
            ? rawPosition(text, typed.start) : undefined
          a.input(text, event.target.selectionStart, marker)
        }}
        onSelect={(event) => a.caret(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
        onBlur={(event) => {
          if (a.locked) return
          const next = event.relatedTarget as Element | null
          if (!next?.closest('[data-filter-helper-interaction]')) a.exit()
        }}
        onKeyDown={(event) => {
          if (!a.active || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key === "Enter") { event.preventDefault(); void a.enter(event.currentTarget.selectionStart, event.currentTarget.selectionEnd) }
          else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); a.exit() }
          else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (a.move(event.key === "ArrowDown" ? 1 : -1)) event.preventDefault()
          } else if (event.key === "Tab" && !event.shiftKey && a.acceptHighlighted()) event.preventDefault()
        }}
      />
      <AssistanceScope inputRef={input} source={source.text} range={a.activeRange} />
    </div>
  )
}

import { useLayoutEffect, useRef, type RefObject } from "react"
import { displaySource } from "../model/raw-input"

// This transparent mirror marks editing scope without changing textarea text,
// selection, input-method handling or native query interpretation.
export function AssistanceScope({ inputRef, source, range }: {
  inputRef: RefObject<HTMLTextAreaElement | null>
  source: string
  range?: { start: number; end: number }
}) {
  const mirror = useRef<HTMLDivElement>(null), viewport = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const input = inputRef.current, content = mirror.current, frame = viewport.current
    if (!range || !input || !content || !frame) return
    const update = () => {
      const style = getComputedStyle(input)
      for (const property of ["font-family", "font-size", "font-weight", "font-style", "line-height",
        "letter-spacing", "text-transform", "text-indent", "text-align", "direction", "tab-size",
        "word-spacing", "word-break", "overflow-wrap", "white-space", "padding-top", "padding-right",
        "padding-bottom", "padding-left", "border-top-width", "border-right-width", "border-bottom-width",
        "border-left-width", "border-style"])
        content.style.setProperty(property, style.getPropertyValue(property))
      content.style.width = `${input.clientWidth + input.clientLeft * 2}px`
      content.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`
      frame.style.width = `${input.clientWidth + input.clientLeft * 2}px`
      frame.style.height = `${input.clientHeight + input.clientTop * 2}px`
    }
    const observer = new ResizeObserver(update)
    observer.observe(input)
    input.addEventListener("scroll", update)
    update()
    return () => { observer.disconnect(); input.removeEventListener("scroll", update) }
  }, [inputRef, source, range?.start, range?.end])
  if (!range) return null
  return <div ref={viewport} aria-hidden="true" className="filter-assistance-scope">
    <div ref={mirror} className="filter-assistance-scope-content">
      {displaySource(source.slice(0, range.start))}<mark data-filter-active-scope>{displaySource(source.slice(range.start, range.end)) || "\u200b"}</mark>{displaySource(source.slice(range.end))}{"\u200b"}
    </div>
  </div>
}

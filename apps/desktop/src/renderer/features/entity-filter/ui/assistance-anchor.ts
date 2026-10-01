import { useLayoutEffect, useRef, useState, type RefObject } from "react"

type Anchor = { getBoundingClientRect: () => DOMRect; contextElement: HTMLTextAreaElement }

// Textareas expose selection offsets but no caret rectangle. A hidden layout
// mirror preserves their actual wrapping, typography and scrolling; it never
// interprets or changes query source. The popover owns collision handling.
export function useAssistanceAnchor(input: RefObject<HTMLTextAreaElement | null>, active: boolean, position?: number) {
  const [anchor, setAnchor] = useState<Anchor | null>(null)
  const measure = useRef<() => void>(() => {})
  const start = useRef(position)
  start.current = position
  useLayoutEffect(() => {
    const element = input.current
    if (!active || !element) { setAnchor(null); return }
    const mirror = document.createElement("div"), marker = document.createElement("span")
    mirror.setAttribute("aria-hidden", "true")
    mirror.style.cssText = "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;overflow:hidden;"
    document.body.append(mirror)
    let frame = 0
    const update = () => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect()
      for (const property of ["font-family", "font-size", "font-weight", "font-style", "font-variant",
        "line-height", "letter-spacing", "text-transform", "text-indent", "text-align", "direction",
        "tab-size", "word-spacing", "word-break", "overflow-wrap", "white-space", "padding-top",
        "padding-right", "padding-bottom", "padding-left", "border-top-width", "border-right-width",
        "border-bottom-width", "border-left-width", "border-style"])
        mirror.style.setProperty(property, style.getPropertyValue(property))
      mirror.style.boxSizing = "border-box"
      mirror.style.width = `${element.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2
      const rectangleAt = (offset: number) => {
        mirror.textContent = element.value.slice(0, offset)
        marker.textContent = element.value.slice(offset) || "\u200b"
        mirror.append(marker)
        return new DOMRect(box.left + element.clientLeft + marker.offsetLeft - element.scrollLeft,
          box.top + element.clientTop + marker.offsetTop - element.scrollTop, 1, lineHeight)
      }
      const visible = (rect: DOMRect) => rect.bottom > box.top + element.clientTop &&
        rect.top < box.top + element.clientTop + element.clientHeight && rect.left >= box.left && rect.left <= box.right
      // Anchor to the current native field/value start, not every new character.
      // When a long value scrolls its beginning away, follow the visible caret.
      let rect = rectangleAt(start.current ?? element.selectionStart)
      if (!visible(rect)) rect = rectangleAt(element.selectionStart)
      // Scrolling source away from the caret hides the menu without ending the
      // editing session. Typing/selection can reveal it again at the real caret.
      setAnchor((old) => {
        if (!visible(rect)) return null
        const previous = old?.getBoundingClientRect()
        return previous?.x === rect.x && previous.y === rect.y && previous.height === lineHeight ? old :
          { getBoundingClientRect: () => rect, contextElement: element }
      })
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update) }
    measure.current = update
    const resize = new ResizeObserver(schedule)
    resize.observe(element)
    const dialog = element.closest('[role="dialog"]')
    if (dialog) resize.observe(dialog)
    document.addEventListener("selectionchange", schedule)
    document.addEventListener("scroll", schedule, true)
    window.addEventListener("resize", schedule)
    update()
    return () => {
      measure.current = () => {}
      cancelAnimationFrame(frame); resize.disconnect(); mirror.remove()
      document.removeEventListener("selectionchange", schedule)
      document.removeEventListener("scroll", schedule, true)
      window.removeEventListener("resize", schedule)
    }
  }, [input, active])
  useLayoutEffect(() => { if (active) measure.current() })
  return anchor
}

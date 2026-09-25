import { createElement, Fragment, useMemo, type ReactNode } from "react"
import { SourceLink } from "@/entities/entity"
import { Separator } from "@/shared/ui/separator"

const textTags = new Set([
  "p",
  "div",
  "span",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "del",
  "mark",
  "small",
  "sub",
  "sup",
  "blockquote",
  "pre",
  "code",
  "kbd",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "figure",
  "figcaption",
])
const omittedTags = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "template",
  "noscript",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "video",
  "audio",
  "source",
  "track",
])

/** Parse saved HTML in an inert template, then rebuild permitted formatting.
 * Provider styling, handlers and resource-loading elements are never mounted. */
export function CivitaiRichText({
  html,
  baseUrl,
  empty,
}: {
  html: string | null | undefined
  baseUrl: string
  empty: string
}) {
  const content = useMemo(() => {
    if (!html?.trim()) return <p className="text-muted-foreground">{empty}</p>
    const template = document.createElement("template")
    template.innerHTML = html
    if (!template.content.children.length)
      return <p className="whitespace-pre-wrap">{template.content.textContent}</p>

    function render(node: Node, key: number, inLink = false): ReactNode {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent
      if (!(node instanceof Element) || node.namespaceURI !== "http://www.w3.org/1999/xhtml") return null
      const tag = node.localName
      if (omittedTags.has(tag)) return null
      if (tag === "img") {
        const url = webUrl(node.getAttribute("src"), baseUrl)
        const label = node.getAttribute("alt")?.trim() || "Description image"
        return (
          <span key={key} className="text-muted-foreground">
            {url && !inLink ? <SourceLink url={url}>{label} ↗</SourceLink> : label}
          </span>
        )
      }
      const children = Array.from(node.childNodes, (child, index) =>
        render(child, index, inLink || tag === "a"),
      )
      if (tag === "a") {
        const url = webUrl(node.getAttribute("href"), baseUrl)
        return url && !inLink ? (
          <SourceLink key={key} url={url}>
            {children}
          </SourceLink>
        ) : (
          <Fragment key={key}>{children}</Fragment>
        )
      }
      if (tag === "hr") return <Separator key={key} />
      if (!textTags.has(tag)) return <Fragment key={key}>{children}</Fragment>
      const attributes: Record<string, unknown> = { key }
      if (tag === "ol") {
        const start = integerAttribute(node, "start")
        if (start !== undefined) attributes.start = start
        if (node.hasAttribute("reversed")) attributes.reversed = true
      }
      if (tag === "th" || tag === "td") {
        const colSpan = integerAttribute(node, "colspan")
        const rowSpan = integerAttribute(node, "rowspan")
        if (colSpan !== undefined && colSpan > 0) attributes.colSpan = colSpan
        if (rowSpan !== undefined && rowSpan > 0) attributes.rowSpan = rowSpan
      }
      const element = createElement(tag, attributes, tag === "br" ? undefined : children)
      return tag === "table" ? (
        <div key={key} className="overflow-x-auto">
          {element}
        </div>
      ) : (
        element
      )
    }
    return Array.from(template.content.childNodes, (node, index) => render(node, index))
  }, [html, baseUrl, empty])
  return (
    <div className="civitai-rich-text" data-slot="civitai-rich-text">
      {content}
    </div>
  )
}

function webUrl(value: string | null, base: string): string | undefined {
  if (!value?.trim()) return undefined
  try {
    const url = new URL(value, base)
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

function integerAttribute(element: Element, name: string): number | undefined {
  const value = element.getAttribute(name)
  if (value === null || !/^-?\d+$/.test(value)) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}

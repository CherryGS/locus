import type { Wire } from "@/shared/api"

/** The backend parses both native sources; parentheses preserve each source's scope. */
export function combinedSearchSource(search: string, filter: Wire<"FilterSource"> | undefined, profile: Pick<Wire<"FilterSource">, "format" | "version">): Wire<"FilterSource"> | undefined {
  const text = search.trim()
  if (!text) return filter
  const selected = filter ?? profile
  return { format: selected.format, version: selected.version, text: filter ? `(${text}) AND (${filter.text})` : text }
}

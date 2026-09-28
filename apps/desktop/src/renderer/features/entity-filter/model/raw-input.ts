// HTML textarea values normalize CRLF/CR to LF. Apply the actual edit to the
// original string so untouched line endings survive loading and ordinary edits.
export const displaySource = (source: string) => source.replace(/\r\n?/g, "\n")
export function editSource(original: string, value: string) {
  const previous = displaySource(original)
  if (previous === value) return original
  let start = 0
  while (start < previous.length && start < value.length && previous[start] === value[start]) start++
  let oldEnd = previous.length,
    newEnd = value.length
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === value[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  const rawPosition = (position: number) => {
    let raw = 0,
      visible = 0
    while (visible < position) {
      raw += original[raw] === "\r" && original[raw + 1] === "\n" ? 2 : 1
      visible++
    }
    return raw
  }
  return (
    original.slice(0, rawPosition(start)) + value.slice(start, newEnd) + original.slice(rawPosition(oldEnd))
  )
}
export function diagnosticPosition(source: string, bytes: number) {
  let consumed = 0,
    prefix = ""
  for (const ch of source) {
    const length = new TextEncoder().encode(ch).length
    if (consumed + length > bytes) break
    consumed += length
    prefix += ch
  }
  return displaySource(prefix).length
}

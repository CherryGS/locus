// HTML textarea values normalize CRLF/CR to LF. Apply the actual edit to the
// original string so untouched line endings survive loading and ordinary edits.
export const displaySource = (source: string) => source.replace(/\r\n?/g, "\n")
export function rawPosition(source: string, position: number) {
  let raw = 0, visible = 0
  while (visible < position && raw < source.length) {
    raw += source[raw] === "\r" && source[raw + 1] === "\n" ? 2 : 1
    visible++
  }
  return raw
}
export const bytePosition = (source: string, position: number) =>
  new TextEncoder().encode(source.slice(0, rawPosition(source, position))).length
export function byteToRaw(source: string, bytes: number) {
  if (bytes === 0) return 0
  let consumed = 0, raw = 0
  for (const ch of source) {
    consumed += new TextEncoder().encode(ch).length
    if (consumed > bytes) throw new Error("Assistance returned an invalid UTF-8 boundary.")
    raw += ch.length
    if (consumed === bytes) return raw
  }
  throw new Error("Assistance returned a range outside the source.")
}
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
  return (
    original.slice(0, rawPosition(original, start)) + value.slice(start, newEnd) + original.slice(rawPosition(original, oldEnd))
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

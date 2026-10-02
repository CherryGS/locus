/** Date's supported range is smaller than the exact integer range of Number. */
export function unixMillisecondsIso(value: string | number) {
  const raw = String(value)
  if (!/^-?\d+$/.test(raw)) return undefined
  const milliseconds = BigInt(raw)
  if (milliseconds < -8640000000000000n || milliseconds > 8640000000000000n) return undefined
  return new Date(Number(milliseconds)).toISOString()
}

/** Format integer source claims without rounding away their millisecond precision. */
export function formatDurationMilliseconds(value: string | number) {
  const raw = String(value)
  if (!/^\d+$/.test(raw)) return undefined
  const milliseconds = BigInt(raw)
  const seconds = milliseconds / 1000n
  const hours = seconds / 3600n
  const minutes = (seconds / 60n) % 60n
  const remainder = String(seconds % 60n).padStart(2, "0")
  const fraction = String(milliseconds % 1000n)
    .padStart(3, "0")
    .replace(/0+$/, "")
  const duration =
    hours > 0n ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`
  return fraction ? `${duration}.${fraction}` : duration
}

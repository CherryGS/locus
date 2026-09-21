export function formatFileSize(input: number | string) {
  const bytes = typeof input === "string" ? Number(input) : input
  const units = ["bytes", "KiB", "MiB", "GiB", "TiB"]
  let unit = 0
  let value = bytes
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`
}

// Chromium clamps large CSS surfaces. Keep the physical surface comfortably
// below that measured clamp and translate it to the complete logical sequence.
export function scrollMapping(logicalHeight: number, viewportHeight: number, maximum = 8_000_000) {
  const height = Math.max(viewportHeight, Math.min(logicalHeight, maximum))
  const logicalMax = Math.max(0, logicalHeight - viewportHeight)
  const physicalMax = Math.max(0, height - viewportHeight)
  const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value))
  return {
    height,
    logical: (physical: number) => (physicalMax ? (clamp(physical, physicalMax) / physicalMax) * logicalMax : 0),
    physical: (logical: number) => (logicalMax ? (clamp(logical, logicalMax) / logicalMax) * physicalMax : 0),
  }
}

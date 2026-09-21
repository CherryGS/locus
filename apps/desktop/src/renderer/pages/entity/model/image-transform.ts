export type ImageSize = { width: number; height: number }
export type ImageTransform = { scale: number; x: number; y: number }
export type ImagePoint = { x: number; y: number }

export function fitImageScale(image: ImageSize, viewport: ImageSize) {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1
  return Math.min(1, viewport.width / image.width, viewport.height / image.height)
}

// Point and translation are measured from the viewport center. Preserve the
// image point under the cursor while zooming, using the same decoded resource.
export function zoomImage(view: ImageTransform, factor: number, point: ImagePoint = { x: 0, y: 0 }): ImageTransform {
  const scale = view.scale * factor
  const x = point.x - (point.x - view.x) * factor
  const y = point.y - (point.y - view.y) * factor
  if (scale <= 0 || !Number.isFinite(scale) || !Number.isFinite(x) || !Number.isFinite(y)) return view
  return { scale, x, y }
}

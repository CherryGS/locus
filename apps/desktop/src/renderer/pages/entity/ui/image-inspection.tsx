import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { ImageOffIcon, MinusIcon, PlusIcon } from "lucide-react"
import { cn } from "@/shared/lib/utils"
import { useDelayedPending } from "@/shared/lib/use-delayed-pending"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty"
import {
  fitImageScale,
  zoomImage,
  type ImagePoint,
  type ImageSize,
  type ImageTransform,
} from "../model/image-transform"

export function ImageInspection({
  src,
  name,
  onDecoded,
  onFailed,
  onRetry,
  pending = false,
  preview,
}: {
  src: string | undefined
  name: string
  onDecoded?: () => void
  onFailed?: () => void
  onRetry?: () => void
  pending?: boolean
  preview?: { src: string; width: number; height: number }
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [viewportSize, setViewportSize] = useState<ImageSize>({ width: 0, height: 0 })
  const [imageSize, setImageSize] = useState<ImageSize | null>(null)
  const [failed, setFailed] = useState(false)
  const [manualView, setManualView] = useState<ImageTransform | null>(null)
  const [showZoom, setShowZoom] = useState(false)
  const unavailable = (!src && !pending) || failed
  const ready = !!src && !unavailable && imageSize !== null
  const showPending = useDelayedPending(!unavailable && !ready)
  const fit = imageSize ? fitImageScale(imageSize, viewportSize) : 1
  const view = manualView ?? { scale: fit, x: 0, y: 0 }

  const flashZoom = useCallback(() => {
    clearTimeout(zoomTimer.current)
    setShowZoom(true)
    zoomTimer.current = setTimeout(() => setShowZoom(false), 1200)
  }, [])

  useEffect(() => () => clearTimeout(zoomTimer.current), [])

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const measure = () => setViewportSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    // Opening replaces the focused grid. A persistent previous/next button,
    // however, keeps keyboard focus when it changes the image.
    if (document.activeElement === document.body) element.focus({ preventScroll: true })
    return () => observer.disconnect()
  }, [])

  const zoom = useCallback(
    (factor: number, point?: ImagePoint) => {
      if (!ready) return
      setManualView((previous) => zoomImage(previous ?? { scale: fit, x: 0, y: 0 }, factor, point))
      flashZoom()
    },
    [fit, ready, flashZoom]
  )

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    function wheel(event: WheelEvent) {
      event.preventDefault()
      if (!element) return
      const rect = element.getBoundingClientRect()
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1)
      zoom(2 ** (-pixels / 500), {
        x: event.clientX - rect.left - rect.width / 2,
        y: event.clientY - rect.top - rect.height / 2,
      })
    }
    element.addEventListener("wheel", wheel, { passive: false })
    return () => element.removeEventListener("wheel", wheel)
  }, [zoom])

  function zoomKey(event: KeyboardEvent) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !ready) return
    if (event.key === "+" || event.key === "=") zoom(1.25)
    else if (event.key === "-") zoom(0.8)
    else if (event.key === "0") resetFit()
    else return
    event.preventDefault()
  }

  function resetFit() {
    setManualView(null)
    flashZoom()
  }

  function beginPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !ready || drag.current) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }

  function pan(event: PointerEvent<HTMLDivElement>) {
    const previous = drag.current
    if (!previous || previous.id !== event.pointerId) return
    const dx = event.clientX - previous.x
    const dy = event.clientY - previous.y
    drag.current = { id: previous.id, x: event.clientX, y: event.clientY }
    setManualView((current) => ({ scale: current?.scale ?? fit, x: (current?.x ?? 0) + dx, y: (current?.y ?? 0) + dy }))
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      ref={viewport}
      data-slot="image-viewport"
      data-state={unavailable ? "unavailable" : ready ? "ready" : "loading"}
      role="region"
      aria-label="Image preview"
      aria-busy={!unavailable && !ready}
      tabIndex={0}
      className={cn(
        "relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden outline-none select-none",
        ready && "cursor-grab active:cursor-grabbing"
      )}
      onKeyDown={zoomKey}
      onPointerDown={beginPan}
      onPointerMove={pan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onLostPointerCapture={() => {
        drag.current = null
      }}
    >
      {!unavailable && !ready && preview && (
        <img data-slot="image-loading-preview" src={preview.src} alt="" aria-hidden="true" draggable={false}
          className="pointer-events-none absolute top-1/2 left-1/2 max-w-none select-none"
          style={{ width: preview.width, height: preview.height,
            transform: `translate(-50%, -50%) scale(${fitImageScale(preview, viewportSize)})` }} />
      )}
      {src && !failed && (
        <img
          src={src}
          alt={name}
          draggable={false}
          className="pointer-events-none absolute top-1/2 left-1/2 max-w-none select-none"
          style={{
            width: imageSize?.width,
            height: imageSize?.height,
            opacity: ready ? 1 : 0,
            transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
          onLoad={(event) => {
            const { naturalWidth: width, naturalHeight: height } = event.currentTarget
            if (width > 0 && height > 0) {
              setImageSize({ width, height })
              onDecoded?.()
            } else {
              setFailed(true)
              onFailed?.()
            }
          }}
          onError={() => {
            setFailed(true)
            onFailed?.()
          }}
        />
      )}
      {unavailable ? (
        <Empty className="h-full" role="status">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ImageOffIcon />
            </EmptyMedia>
            <EmptyTitle>Unable to display image</EmptyTitle>
            <EmptyDescription>Return to the source or continue browsing.</EmptyDescription>
          </EmptyHeader>
          {onRetry && (
            <Button variant="outline" onClick={onRetry}>
              Retry image
            </Button>
          )}
        </Empty>
      ) : (
        showPending && (
          <p role="status" className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <span className="relative rounded-md bg-background/80 px-3 py-2">Loading image…</span>
          </p>
        )
      )}
      {ready && (
        <div
          data-slot="image-zoom-feedback"
          className={cn(
            "pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 cursor-default items-center gap-1 rounded-full border bg-popover/90 p-1 shadow-sm opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100",
            showZoom && "pointer-events-auto opacity-100"
          )}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerEnter={() => {
            clearTimeout(zoomTimer.current)
            setShowZoom(true)
          }}
          onPointerLeave={flashZoom}
        >
          <Button variant="ghost" size="icon-sm" aria-label="Zoom out" title="Zoom out (-)" onClick={() => zoom(0.8)}>
            <MinusIcon data-icon="inline-start" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="min-w-14"
            aria-label="Fit image"
            title="Fit image (0)"
            onClick={resetFit}
          >
            <span className="tabular-nums">{Math.round(view.scale * 100)}%</span>
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoom(1.25)}>
            <PlusIcon data-icon="inline-start" />
          </Button>
        </div>
      )}
    </div>
  )
}

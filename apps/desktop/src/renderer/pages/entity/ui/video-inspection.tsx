import { useEffect, useRef, useState } from "react"
import { VideoOffIcon } from "lucide-react"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty"

export function VideoInspection({ src, poster, name }: {
  src: string | undefined
  poster: string | undefined
  name: string
}) {
  const player = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const unavailable = !src || failed

  useEffect(() => {
    const video = player.current
    if (!video || !src || failed) return
    // This view owns the sole active player. Rebind on effect setup so React's
    // development cleanup/setup cycle also leaves a usable source.
    video.src = src
    return () => {
      video.pause()
      video.removeAttribute("src")
      video.load()
    }
  }, [src, failed])

  return (
    <div
      data-slot="video-viewport"
      data-state={unavailable ? "unavailable" : ready ? "ready" : "loading"}
      role="region"
      aria-label="Video preview"
      aria-busy={!unavailable && !ready}
      className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center"
    >
      {unavailable ? (
        <Empty className="h-full" role="status">
          <EmptyHeader>
            <EmptyMedia variant="icon"><VideoOffIcon /></EmptyMedia>
            <EmptyTitle>Unable to play video</EmptyTitle>
            <EmptyDescription>Return to the source or continue browsing.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <video
            ref={player}
            aria-label={name}
            poster={poster}
            controls
            playsInline
            preload="metadata"
            controlsList="nofullscreen noremoteplayback"
            disablePictureInPicture
            className="size-full object-contain outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            onLoadedMetadata={() => setReady(true)}
            onError={() => setFailed(true)}
          />
          {!ready && <p role="status" className="pointer-events-none absolute text-sm text-muted-foreground">Loading video…</p>}
        </>
      )}
    </div>
  )
}

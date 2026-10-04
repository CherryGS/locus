import { usePageActivity } from "@/shared/page-activity"
import { useEffect, useRef, useState } from "react"
import { MaximizeIcon, MinimizeIcon, RotateCcwIcon, VideoOffIcon } from "lucide-react"
import type { PlaybackCoordinator } from "@/features/video-playback"
import { Button } from "@/shared/ui/button"
import { Spinner } from "@/shared/ui/spinner"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty"

export function VideoInspection({
  src,
  poster,
  name,
  playback,
  entityId = name,
  fileId = src ?? "",
  componentId = "",
  attempt = 0,
  pending = false,
  onResult,
  onRetry,
}: {
  src?: string
  poster?: string
  name: string
  playback?: PlaybackCoordinator
  entityId?: string
  fileId?: string
  componentId?: string
  attempt?: number
  pending?: boolean
  onResult?: (message?: string) => void
  onRetry?: () => void
}) {
  const { active: pageActive } = usePageActivity()
  const controlGeneration = useRef(0)
  const fullscreenWanted = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const player = useRef<HTMLVideoElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const outcome = useRef(onResult)
  outcome.current = onResult
  const [ready, setReady] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [controlError, setControlError] = useState<string>()
  const [ended, setEnded] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const video = player.current
    if (!video || !src || !pageActive) return
    const report = outcome.current
    let active = true
    let terminalFailure = false
    setReady(false)
    setFailure(undefined)
    setEnded(false)
    let restored = false
    const stop = () => {
      controlGeneration.current++
      fullscreenWanted.current = false
      video.pause()
      save()
      if (document.fullscreenElement === viewport.current) void document.exitFullscreen().catch(() => {})
    }
    const lease = playback?.activate(entityId, fileId, stop)
    function save() {
      lease?.save(restored && !terminalFailure ? video!.currentTime : Number.NaN, video!.volume, video!.muted)
    }
    const reject = (message: string) => {
      if (!active || terminalFailure) return
      save()
      terminalFailure = true
      stop()
      setFailure(message)
      report?.(message)
    }
    video.volume = playback?.volume ?? 1
    video.muted = playback?.muted ?? false
    const metadata = () => {
      if (!active || terminalFailure) return
      const position = lease?.position ?? 0
      if (position > 0) {
        if (Number.isFinite(video.duration) && position > video.duration) {
          const message =
            "The saved playback position is outside this video's duration. The video remains paused; retry to recheck the input."
          reject(message)
          return
        }
        try {
          video.currentTime = position
        } catch {
          reject("The saved playback position could not be restored. Retry to recheck the current input.")
        }
      } else restored = true
    }
    const decoded = () => {
      if (!active || terminalFailure || !restored || video.seeking || video.readyState < 2) return
      if (!video.videoWidth || !video.videoHeight) {
        failed()
        return
      }
      setReady(true)
      report?.()
    }
    const sought = () => {
      if (!active || terminalFailure) return
      if (!restored) {
        if (Math.abs(video.currentTime - (lease?.position ?? 0)) < 0.1) restored = true
        else {
          reject("The saved playback position could not be restored. Retry to recheck the current input.")
          return
        }
      }
      save()
      decoded()
    }
    const failed = () => {
      if (!active || terminalFailure) return
      const message =
        video.error?.code === 2
          ? "The video bytes could not be read. Retry to recheck the current input."
          : video.error?.code === 3
            ? "The current video could not be decoded. Retry or inspect its details in Overview."
            : "This input could not be played. Its format may be unsupported or its bytes unavailable."
      reject(message)
    }
    const complete = () => {
      if (active && !terminalFailure) {
        save()
        setEnded(true)
      }
    }
    const playing = () => {
      if (active && !terminalFailure) setEnded(false)
    }
    video.addEventListener("loadedmetadata", metadata)
    video.addEventListener("loadeddata", decoded)
    video.addEventListener("error", failed)
    video.addEventListener("timeupdate", save)
    video.addEventListener("seeked", sought)
    video.addEventListener("volumechange", save)
    video.addEventListener("pause", save)
    video.addEventListener("ended", complete)
    video.addEventListener("playing", playing)
    video.src = src
    return () => {
      active = false
      stop()
      lease?.release()
      video.removeEventListener("loadedmetadata", metadata)
      video.removeEventListener("loadeddata", decoded)
      video.removeEventListener("error", failed)
      video.removeEventListener("timeupdate", save)
      video.removeEventListener("seeked", sought)
      video.removeEventListener("volumechange", save)
      video.removeEventListener("pause", save)
      video.removeEventListener("ended", complete)
      video.removeEventListener("playing", playing)
      video.removeAttribute("src")
      video.load()
    }
  }, [src, playback, entityId, fileId, componentId, attempt, pageActive])

  useEffect(() => {
    if (pending) player.current?.pause()
  }, [pending])
  useEffect(() => {
    if (!pageActive) return
    const changed = () => {
      const entered = document.fullscreenElement === viewport.current
      if (entered && !fullscreenWanted.current) {
        void document.exitFullscreen().catch(() => {})
        return
      }
      setFullscreen(entered)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.fullscreenElement !== viewport.current) return
      // Capture before the page's source-return handler. Some Chromium versions
      // reserve Esc for native fullscreen; those do not dispatch this keydown.
      event.stopPropagation()
      event.preventDefault()
      void document.exitFullscreen().catch(() => {
        if (mounted.current) setControlError("Unable to leave fullscreen.")
      })
    }
    document.addEventListener("fullscreenchange", changed)
    window.addEventListener("keydown", escape, true)
    return () => {
      document.removeEventListener("fullscreenchange", changed)
      window.removeEventListener("keydown", escape, true)
    }
  }, [pageActive])
  async function toggleFullscreen() {
    const request = ++controlGeneration.current
    const target = viewport.current
    fullscreenWanted.current = document.fullscreenElement !== target
    setControlError(undefined)
    try {
      if (!fullscreenWanted.current) await document.exitFullscreen()
      else await target?.requestFullscreen()
      if (
        request !== controlGeneration.current &&
        document.fullscreenElement === target &&
        !fullscreenWanted.current
      )
        await document.exitFullscreen()
    } catch {
      if (mounted.current && request === controlGeneration.current)
        setControlError("Fullscreen is unavailable. You can continue watching here.")
    }
  }
  async function replay() {
    const video = player.current
    if (!video) return
    const request = ++controlGeneration.current
    setControlError(undefined)
    try {
      video.currentTime = 0
      // pause()/load() in stop/release cancels the native pending play request.
      await video.play()
    } catch {
      if (mounted.current && request === controlGeneration.current)
        setControlError("Playback did not start. Use the play control to try again.")
    }
  }
  return (
    <div
      ref={viewport}
      data-slot="video-viewport"
      data-state={
        !src ? (pending ? "loading" : "unavailable") : failure ? "unavailable" : ready ? "ready" : "loading"
      }
      role="region"
      aria-label="Video preview"
      aria-busy={pending || (!!src && !failure && !ready)}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background"
      onKeyDown={(event) => {
        if (event.key !== "Escape" && !event.altKey && !event.metaKey && !event.ctrlKey)
          event.stopPropagation()
      }}
    >
      {src && (
        <video
          ref={player}
          aria-label={name}
          poster={poster}
          controls
          playsInline
          preload="metadata"
          controlsList="nofullscreen noremoteplayback nodownload noplaybackrate"
          disablePictureInPicture
          // Chromium can still show its fullscreen control despite controlsList.
          // Use the viewport button so fullscreen includes status and recovery UI.
          className="min-h-0 w-full flex-1 object-contain outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-media-controls-fullscreen-button]:hidden"
        />
      )}
      {(!src || failure) && (
        <Empty className={src ? "absolute inset-0 bg-background" : "h-full"} role="status">
          <EmptyHeader>
            <EmptyMedia variant="icon">{pending ? <Spinner /> : <VideoOffIcon />}</EmptyMedia>
            <EmptyTitle>{pending ? "Rechecking Video input…" : "Unable to play video"}</EmptyTitle>
            <EmptyDescription>
              {pending
                ? "Reading the current Video input…"
                : (failure ??
                  "The video file could not be loaded. See Overview for details and recovery.")}
            </EmptyDescription>
          </EmptyHeader>
          {onRetry && (
            <Button variant="outline" disabled={pending} onClick={onRetry}>
              {pending && <Spinner data-icon="inline-start" />}Retry video
            </Button>
          )}
        </Empty>
      )}
      {src && !failure && (
        <div className="flex shrink-0 items-center justify-end gap-2 px-3 py-2">
          {(!ready || pending) && (
            <span role="status" className="mr-auto flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              {pending ? "Rechecking Video input…" : "Loading video…"}
            </span>
          )}
          {controlError && (
            <span role="status" className="mr-auto text-sm text-muted-foreground">
              {controlError}
            </span>
          )}
          {ended && (
            <Button variant="outline" onClick={() => void replay()}>
              <RotateCcwIcon data-icon="inline-start" />
              Replay
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? (
              <MinimizeIcon data-icon="inline-start" />
            ) : (
              <MaximizeIcon data-icon="inline-start" />
            )}
          </Button>
        </div>
      )}
    </div>
  )
}

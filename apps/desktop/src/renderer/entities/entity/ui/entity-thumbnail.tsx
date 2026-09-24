import { AtSignIcon, BoxIcon, FileIcon, VideoIcon } from "lucide-react"
import { useState } from "react"

export function EntityThumbnail({
  src,
  hasFile,
  hasVideo = false,
  hasTwitter = false,
  fallbackLabel,
}: {
  src: string | undefined
  hasFile: boolean
  hasVideo?: boolean
  hasTwitter?: boolean
  fallbackLabel?: string
}) {
  const [failedSource, setFailedSource] = useState<string>()
  if (src && src !== failedSource) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        decoding="async"
        className="size-full object-contain"
        onError={() => setFailedSource(src)}
      />
    )
  }

  const Icon = hasVideo ? VideoIcon : hasFile ? FileIcon : hasTwitter ? AtSignIcon : BoxIcon
  return (
    <div
      className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground"
      aria-hidden="true"
    >
      <Icon className="size-9" strokeWidth={1.25} />
      {fallbackLabel && <span className="text-xs">{fallbackLabel}</span>}
    </div>
  )
}

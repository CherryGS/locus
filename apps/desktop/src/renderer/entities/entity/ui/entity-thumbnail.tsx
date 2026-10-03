import { AtSignIcon, BoxIcon, FileIcon, VideoIcon, type LucideIcon } from "lucide-react"
import { useState } from "react"

export function EntityThumbnail({
  src,
  hasFile,
  hasVideo = false,
  hasTwitter = false,
  fallbackLabel,
  fallbackIcon,
}: {
  src: string | undefined
  hasFile: boolean
  hasVideo?: boolean
  hasTwitter?: boolean
  fallbackLabel?: string
  fallbackIcon?: LucideIcon
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

  const Icon = fallbackIcon ?? (hasVideo ? VideoIcon : hasFile ? FileIcon : hasTwitter ? AtSignIcon : BoxIcon)
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

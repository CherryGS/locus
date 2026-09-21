import { AtSignIcon, BoxIcon, FileIcon, VideoIcon } from "lucide-react"
import { useState } from "react"

export function EntityThumbnail({ src, hasFile, hasVideo = false, hasTwitter = false }: { src: string | undefined; hasFile: boolean; hasVideo?: boolean; hasTwitter?: boolean }) {
  const [failedSource, setFailedSource] = useState<string>()
  if (src && src !== failedSource) {
    return <img src={src} alt="" draggable={false} decoding="async" className="size-full object-contain" onError={() => setFailedSource(src)} />
  }

  const Icon = hasVideo ? VideoIcon : hasFile ? FileIcon : hasTwitter ? AtSignIcon : BoxIcon
  return (
    <div className="flex size-full items-center justify-center text-muted-foreground" aria-hidden="true">
      <Icon className="size-9" strokeWidth={1.25} />
    </div>
  )
}

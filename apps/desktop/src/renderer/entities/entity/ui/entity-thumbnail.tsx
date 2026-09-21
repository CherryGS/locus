import { BoxIcon, FileIcon } from "lucide-react"
import { useState } from "react"

export function EntityThumbnail({ src, hasFile }: { src: string | undefined; hasFile: boolean }) {
  const [failedSource, setFailedSource] = useState<string>()
  if (src && src !== failedSource) {
    return <img src={src} alt="" draggable={false} decoding="async" className="size-full object-contain" onError={() => setFailedSource(src)} />
  }

  const Icon = hasFile ? FileIcon : BoxIcon
  return (
    <div className="flex size-full items-center justify-center text-muted-foreground" aria-hidden="true">
      <Icon className="size-9" strokeWidth={1.25} />
    </div>
  )
}

import { BoxIcon, FileIcon } from "lucide-react"

export function EntityThumbnail({ src, hasFile }: { src: string | undefined; hasFile: boolean }) {
  if (src) {
    return <img src={src} alt="" draggable={false} decoding="async" className="size-full object-contain" />
  }

  const Icon = hasFile ? FileIcon : BoxIcon
  return (
    <div className="flex size-full items-center justify-center text-muted-foreground" aria-hidden="true">
      <Icon className="size-9" strokeWidth={1.25} />
    </div>
  )
}

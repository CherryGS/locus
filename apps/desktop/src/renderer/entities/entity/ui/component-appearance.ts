import { AtSignIcon, FileIcon, ImageIcon, VideoIcon, BoxIcon, type LucideIcon } from "lucide-react"
import type { EntityComponent } from "../model/entity-item"

export const componentAppearance = {
  civitai: { label: "Civitai", icon: BoxIcon },
  model: { label: "Model", icon: BoxIcon },
  file: { label: "File", icon: FileIcon },
  image: { label: "Image", icon: ImageIcon },
  video: { label: "Video", icon: VideoIcon },
  twitter: { label: "Twitter", icon: AtSignIcon },
  bilibili: { label: "Bilibili", icon: VideoIcon },
  unknown: { label: "Unsupported", icon: BoxIcon },
} satisfies Record<EntityComponent["kind"], { label: string; icon: LucideIcon }>

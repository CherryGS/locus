import { TagsIcon, AtSignIcon, FileIcon, ImageIcon, VideoIcon, BoxIcon, type LucideIcon } from "lucide-react"
import type { EntityComponent } from "../model/entity-item"

export const componentAppearance = {
  tag: { label: "Tags", icon: TagsIcon },
  civitai: { label: "Civitai", icon: BoxIcon },
  model: { label: "Model", icon: BoxIcon },
  file: { label: "File", icon: FileIcon },
  image: { label: "Image", icon: ImageIcon },
  video: { label: "Video", icon: VideoIcon },
  bilibili: { label: "Bilibili", icon: VideoIcon },
  twitter: { label: "Twitter", icon: AtSignIcon },
  unknown: { label: "Unsupported", icon: BoxIcon },
} satisfies Record<EntityComponent["kind"], { label: string; icon: LucideIcon }>

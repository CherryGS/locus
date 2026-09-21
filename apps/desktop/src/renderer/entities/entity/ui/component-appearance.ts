import { AtSignIcon, FileIcon, ImageIcon, VideoIcon, type LucideIcon } from "lucide-react"
import type { EntityComponent } from "../model/entity-item"

export const componentAppearance = {
  file: { label: "File", icon: FileIcon },
  image: { label: "Image", icon: ImageIcon },
  video: { label: "Video", icon: VideoIcon },
  twitter: { label: "Twitter", icon: AtSignIcon },
} satisfies Record<EntityComponent["kind"], { label: string; icon: LucideIcon }>

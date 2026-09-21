import { formatFileSize } from "../lib/format-file-size.ts"
import { formatDuration } from "../lib/format-duration.ts"
import type { EntityItem } from "./entity-item"

export type ImageDisplayItem = { src: string }

export const fileDisplayItems = {
  originalName(entity: EntityItem): string | undefined {
    return entity.components.find((component) => component.kind === "file")?.originalName
  },
  size(entity: EntityItem): string | undefined {
    const file = entity.components.find((component) => component.kind === "file")
    return file?.bytes !== undefined ? formatFileSize(file.bytes) : undefined
  },
}

export const imageDisplayItems = {
  preview(entity: EntityItem): ImageDisplayItem | undefined {
    const src = entity.components.find((component) => component.kind === "image")?.thumbnail
    return src ? { src } : undefined
  },
  dimensions(entity: EntityItem): string | undefined {
    const image = entity.components.find((component) => component.kind === "image")
    return image?.width !== undefined && image.height !== undefined ? `${image.width} × ${image.height}` : undefined
  },
}

export const videoDisplayItems = {
  preview(entity: EntityItem): ImageDisplayItem | undefined {
    const src = entity.components.find((component) => component.kind === "video")?.thumbnail
    return src ? { src } : undefined
  },
  duration(entity: EntityItem): string | undefined {
    const seconds = entity.components.find((component) => component.kind === "video")?.durationSeconds
    return seconds === undefined ? undefined : formatDuration(seconds)
  },
}

export const twitterDisplayItems = {
  title(entity: EntityItem): string | undefined {
    const twitter = entity.components.find((component) => component.kind === "twitter")
    return twitter?.text?.trim() || (twitter?.postId ? `Post ${twitter.postId}` : twitter?.postUrl)
  },
  author(entity: EntityItem): string | undefined {
    const author = entity.components.find((component) => component.kind === "twitter")?.author
    return author?.handle ? `@${author.handle}` : author?.displayName
  },
}

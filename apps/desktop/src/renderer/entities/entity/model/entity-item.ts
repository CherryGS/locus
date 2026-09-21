// Renderer projections, not HTTP DTOs or independently editable domain records.
export type EntityComponent =
  | {
      kind: "file"
      id: string
      originalName: string
      bytes: number
      importedAt: string
    }
  | {
      kind: "image"
      id: string
      format: string
      width: number
      height: number
      thumbnail?: string
      colorMode: string
      bitsPerChannel: number
      hasAlphaChannel: boolean
    }
  | {
      kind: "video"
      id: string
      format?: string
      width?: number
      height?: number
      durationSeconds?: number
      frameRate?: number
      codec?: string
      thumbnail?: string
      src?: string
    }
  | {
      kind: "twitter"
      id: string
      postId?: string
      postUrl?: string
      text?: string
      author?: {
        displayName?: string
        handle?: string
        userId?: string
        profileUrl?: string
      }
      publishedAt?: string
      capturedAt?: string
      // The source's observed zero-based order; display it as one-based.
      sourceOrder?: number
      altText?: string
      references?: readonly {
        kind: "reply" | "quote" | "repost"
        postId?: string
        url?: string
      }[]
    }

export type EntityItem = {
  id: string
  name: string
  components: readonly EntityComponent[]
}

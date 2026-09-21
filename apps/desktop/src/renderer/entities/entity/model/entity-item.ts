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

export type EntityItem = {
  id: string
  name: string
  components: readonly EntityComponent[]
}

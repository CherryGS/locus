// Renderer projections, not HTTP DTOs or independently editable domain records.
export type EntityComponent =
  | { kind: "file"; id: string; name: string; mediaType: string; bytes: number }
  | { kind: "image"; id: string; format: string; width: number; height: number }

export type EntityItem = {
  id: string
  name: string
  thumbnail?: string
  components: readonly EntityComponent[]
}

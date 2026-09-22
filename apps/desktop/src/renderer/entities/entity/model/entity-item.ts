// Renderer projections, not HTTP DTOs or independently editable domain records.
import type { Wire } from "@/shared/api"
import type { ReadProblem } from "./read-problem"
type Observation = { readStatus?: "loading" | "ready" | "failed" | "unsupported"; previous?: boolean; kindId?: string }
export type EntityComponent = Observation &
  (
    | {
        kind: "file"
        id: string
        originalName?: string
        bytes?: number | string
        importedAt?: string
        relativePath?: string
      }
    | {
        kind: "image"
        id: string
        format?: string
        width?: number
        height?: number
        thumbnail?: string
        colorMode?: string
        bitsPerChannel?: number
        hasAlphaChannel?: boolean
        inputFileId?: string
        record?: Wire<"MediaRecord">
        applicability?: Wire<"Applicability">
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
        record?: Wire<"MediaRecord">
        applicability?: Wire<"Applicability">
        streamIndex?: number
        inputFileId?: string
        inputPrevious?: boolean
        durationPrecision?: string
      }
    | { kind: "unknown"; id: string; kindId: string }
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
  )

export type EntityItem = {
  id: string
  name?: string
  components: readonly EntityComponent[]
  live?: boolean
  loading?: boolean
  membershipsStatus?: "unread" | "loading" | "present" | "missing" | "failed"
  problems?: readonly ReadProblem[]
}

export const entityLabel = (entity: EntityItem) => entity.name ?? `Entity ${entity.id.slice(-8)}`

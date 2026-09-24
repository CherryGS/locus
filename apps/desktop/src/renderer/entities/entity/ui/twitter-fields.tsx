import type { EntityComponent } from "../model/entity-item"
export { CapturedText, SourceLink } from "./source-fields"
export type TwitterComponent = Extract<EntityComponent, { kind: "twitter" }>

export const twitterReferenceLabels = {
  reply: "Reply to",
  quote: "Quote",
  repost: "Repost",
} as const

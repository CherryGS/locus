import {
  fileDisplayItems,
  imageDisplayItems,
  videoDisplayItems,
  twitterDisplayItems,
  bilibiliDisplayItems,
  type ImageDisplayItem,
} from "./component-display-items.ts"
import { resolveDisplaySlot, type DisplayCandidate } from "./display-slot.ts"
import type { EntityItem } from "./entity-item"

// Card composition owns these choices. Array order is the priority within a
// slot; it does not rank entire component kinds or depend on attachment order.
const cardSlots = {
  title: [fileDisplayItems.originalName, twitterDisplayItems.title, bilibiliDisplayItems.title],
  preview: [bilibiliDisplayItems.preview, imageDisplayItems.preview, videoDisplayItems.preview],
  summary: [
    imageDisplayItems.dimensions,
    videoDisplayItems.duration,
    fileDisplayItems.size,
    twitterDisplayItems.author,
  ],
} as const satisfies {
  title: readonly DisplayCandidate<string>[]
  preview: readonly DisplayCandidate<ImageDisplayItem>[]
  summary: readonly DisplayCandidate<string>[]
}

export function entityCardDisplay(entity: EntityItem) {
  return {
    title: resolveDisplaySlot(entity, cardSlots.title),
    preview: resolveDisplaySlot(entity, cardSlots.preview),
    summary: resolveDisplaySlot(entity, cardSlots.summary),
  }
}

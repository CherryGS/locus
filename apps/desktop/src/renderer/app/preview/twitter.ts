import type { EntityComponent } from "@/entities/entity"

type TwitterSpecimen = Omit<Extract<EntityComponent, { kind: "twitter" }>, "kind" | "id">

// Fictional, offline observations. Rendering never fetches these web addresses.
export const twitterSpecimens = new Map<number, TwitterSpecimen>([
  [2, {
    postId: "1000000000000000002",
    postUrl: "https://x.com/locus_demo/status/1000000000000000002",
    text: "海边的光线慢慢变柔和。\n\nA study of evening light, muted colours and the shape of the coastline.\nKeep the quiet details.\n\n#landscape #reference",
    author: { displayName: "Mira · studies in light", handle: "locus_demo", userId: "1000000000000000000", profileUrl: "https://x.com/locus_demo" },
    publishedAt: "2026-09-18T09:30:00Z", capturedAt: "2026-09-20T02:01:00Z",
    sourceOrder: 1, altText: "A pale sun above a layered coastline, with muted blue and green shapes.",
    references: [{ kind: "quote", postId: "1000000000000000001", url: "https://x.com/i/status/1000000000000000001" }],
  }],
  [5, {
    postId: "1000000000000000005", postUrl: "https://x.com/locus_motion/status/1000000000000000005",
    text: "Small movements, a little rhythm.\nA short motion study for the collection. #motion",
    author: { displayName: "Locus motion studies", handle: "locus_motion", userId: "1000000000000000004", profileUrl: "https://x.com/locus_motion" },
    publishedAt: "2026-09-19T04:15:00Z", capturedAt: "2026-09-20T02:04:00Z",
    sourceOrder: 0, altText: "A light square moving across a dark grid.",
    references: [
      { kind: "reply", postId: "1000000000000000003", url: "https://x.com/i/status/1000000000000000003" },
      { kind: "repost", postId: "1000000000000000002", url: "https://x.com/i/status/1000000000000000002" },
    ],
  }],
  [10, {
    postId: "1000000000000000010", postUrl: "https://x.com/locus_notes/status/1000000000000000010",
    text: "Keep a little room for unfinished ideas.\n\nA few notes on colour, rhythm and the small details that make a collection feel connected.",
    author: { displayName: "Locus notes", handle: "locus_notes", userId: "1000000000000000009", profileUrl: "https://x.com/locus_notes" },
    publishedAt: "2026-09-17T13:40:00Z", capturedAt: "2026-09-20T02:09:00Z",
    references: [],
  }],
  [11, { postId: "1000000000000000011" }],
  [18, { postId: "1000000000000000018", text: "", altText: "", references: [] }],
])

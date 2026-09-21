import type { EntityComponent } from "@/entities/entity"
import landscapeSource from "./media/landscape.mp4?url"
import landscapePoster from "./media/landscape.webp?url"
import portraitSource from "./media/portrait.mp4?url"
import portraitPoster from "./media/portrait.webp?url"

type VideoSpecimen = Omit<Extract<EntityComponent, { kind: "video" }>, "id" | "kind">

// Entity numbers are stable so the same fixtures are easy to revisit in the UI.
export const videoSpecimens = new Map<number, VideoSpecimen>([
  [5, {
    format: "MP4", codec: "H.264", width: 960, height: 540,
    durationSeconds: 8, frameRate: 24, src: landscapeSource, thumbnail: landscapePoster,
  }],
  [6, {
    format: "MP4", codec: "H.264", width: 540, height: 960,
    durationSeconds: 8, frameRate: 24, src: portraitSource, thumbnail: portraitPoster,
  }],
  [12, {
    format: "MP4", codec: "H.264", width: 960, height: 540,
    durationSeconds: 8, frameRate: 24,
    src: "data:video/mp4;base64,broken-video", thumbnail: landscapePoster,
  }],
  [16, {}],
])

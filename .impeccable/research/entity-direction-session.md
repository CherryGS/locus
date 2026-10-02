# Entity foundations direction session

Status: awaiting user direction choice; no visual identity is approved.

- Scope: Entity cards and Inspector as the first bounded sample of shared
  hierarchy, density and action placement. Existing behavior remains authoritative.
- Mode: Operate. Seed: `75117ec9`, assigned grounded candidate 6.
- Decision payload: `entity-decision-75117ec9.json`.
- Local decision page: `http://127.0.0.1:63515/`, question key `7fb55f3c`.
- The user selected incremental mixed image/code work. The decision page uses
  images for this comparison; its `comp` value is not a confirmed global workflow
  default. No `buildPath` was persisted in project configuration.
- Three main directions are shown: broadcast-caption blue-grey, collection-label
  cool light, and midnight wayfinding. The quiet conventional alternative remains
  available. All catalog challengers have recorded verdicts in the payload.
- Each image received one bounded correction pass to remove generated additions
  such as duplicate Inspector previews, accordion arrows, multi-selection boxes
  and large success banners. Final displayed files use the `-v2.png` suffix.
- The page was updated with versioned image paths to invalidate its first-image
  cache. Its subsequent freshness heuristic calls those prepared correction files
  stale because they predate the payload update; they belong to this same seed and
  direction set, not an older direction. They were visually checked as current
  corrections. Do not regenerate identical images merely to change timestamps.
- Remaining illustration drift is not a product requirement: some examples vary
  filenames/count placement; the wayfinding card keeps a selection outline rather
  than a caption marker, and the conventional alternative introduces empty
  size/modified-time rows. Existing data and interaction contracts override those
  generated details. Discuss material selected-image differences before any build.
- All sidecars retain `approved: false`; prompt provenance was embedded and the
  scan found no missing raster provenance. Production interface files are unchanged.

Resume by collecting the existing question's answer with `impeccable serve-question
--wait --key 7fb55f3c`. A selected direction is followed by the shape brief and
confirmation, not automatic production implementation. If the user requests a
re-roll, update this same decision session as the skill describes.

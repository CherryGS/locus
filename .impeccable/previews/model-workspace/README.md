# Model workspace design specimen

This standalone specimen makes the current design discussion inspectable. It is
not the production Locus renderer and does not read or write any library. Values
and model/classification combinations are illustrative; reloading resets them.

Serve only `public`, for example from the project root:

```powershell
uv run python -m http.server 8765 --bind 127.0.0.1 --directory .impeccable/previews/model-workspace/public
```

## What to inspect

- Locus opens another independent model tab. The initial Pony tab has its own
  search. Selection, grid scroll, visibility and drafts are private to each tab;
  simulated saved model values are shared.
- Cards are 240 by 320 CSS pixels with cover cropping and 8px corners. White
  title, version and classification text sits on 76% black. Classification
  rectangles have 4px corners. Titles clamp to two lines; version uses one.
- The 310px inspector keeps the local version, model type and family editable.
  Empty local inputs show source values as placeholders and attribute their
  origin. Saving an empty value restores the effective source value on the card.
- Display controls can hide individual information items or all information.
  Format and size are optional. These controls demonstrate a future capability;
  their preference ownership and production settings UI are not settled here.
- The footer's interaction controls simulate latency, one failed save, and an
  external version change. Errors retain drafts. A close attempt flushes pending
  edits; unresolved saves keep the tab available. A conflict offers the saved
  value or another conditional attempt using the user's retained draft.

## Deliberate limits

The static specimen uses in-memory timers and field comparisons, not real Tasks,
SQLite transactions or HTTP endpoints. It validates the visible flow, not backend
atomicity, persistence, restoration, database schema or cross-process concurrency.
It does not implement source registrations, component resolution, category
admission, singleton pages, deleted-Entity discovery or external generation UIs.
Title and file facts are read-only. The Filter popup performs literal substring
matching solely to exercise search/Filter composition and explicit application;
it is not a proposed replacement for Locus's existing raw Filter editor/language.

## Evidence and observations

Browser checks on 2026-10-04 used the Codex in-app browser at the actual 1280x720
viewport and a temporary 900x720 desktop viewport. Both have no document-width
overflow, fixed 240x320 cards and a 310px inspector. The temporary size was reset.

Observed flows: local version clear -> source `v1.0`; switching to Pony -> four
results and independent search; returning -> eight results; cover-only -> eight
accessible cards and no information overlays; new tab via Locus; save failure ->
retained text and retained tab; retry; delayed save with external modification ->
conflict and retained text; Save my value -> saved version; applying the specimen
Filter `ControlNet` -> two results. The final correction clears stale close-error
footer feedback after a successful retry and resets inspector scroll when its
subject is rendered. JavaScript syntax was checked with `node --check`.

Screenshots in `evidence` include the desktop and narrow desktop layout, cover-only
mode, and failure/conflict interaction traces. The broad source collages visibly
lose context when cropped into a 3:4 card; this remains an observation for the
next discussion, not an implicit decision to add a cover focal-point editor.

The design detector reported the existing Geist family and the full-height
search/Filter segment as warnings. Both preserve the incumbent system and the
explicit `rules/ui.md` segmented-input rule. No identity/token change is proposed.
`DESIGN.md` remains unchanged. Repository UI-iteration rules take precedence over
the skill's additional subagent finish-review/documenter workflow; verification
here is a bounded local browser review, not an independent agent verdict.

## Asset provenance

Raster pixels are existing private sample-library fixtures, copied from
`.local/comprehensive-library/inputs/civitai-public`. Each copy embeds its source
path and the illustrative-data limitation; a provenance scan found zero missing
entries. No original fixture was modified.

| Served name | Fixture path below civitai-public |
| --- | --- |
| agnes-day.jpg | 522077/example-1.jpg |
| agnes-night.jpg | 522077/example-2.jpg |
| deepnegative.jpg | 4629/example-1.jpg |
| armor.jpg | 4629/5638/example-1.jpg |
| cars.jpg | 4629/5638/example-2.jpg |

Geist is copied from the installed `@fontsource-variable/geist` package, with its
license next to the served font. Icons are simple inline geometric SVG symbols.
The direction contract lives outside the served directory in the surface brief.

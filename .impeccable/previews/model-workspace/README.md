# Workspace chrome and card interaction specimen

This standalone specimen makes the current design discussion inspectable. It is
not the production Locus renderer and does not read or write any library. Values
and model/classification combinations are illustrative; reloading resets them.

Serve only `public`, for example from the project root:

```powershell
uv run python -m http.server 49861 --bind 127.0.0.1 --directory .impeccable/previews/model-workspace/public
```

## Current chrome iteration — 2026-10-05

This continues the existing specimen under the confirmed two-row workspace
brief. It does not implement the production renderer or backend. Reload starts
with an empty workspace; use Locus or Open page to begin. All edits, task records,
queries and page contexts are in memory and reset on reload.

- The 40px window row contains Locus, stable category-based browsing-tab names,
  an open-tab list and a reserved native-control area. Repeated category tabs
  receive distinguishing numbers without renaming surviving tabs. A standalone
  task-result tab uses its content name. Tab overflow scrolls, including the
  whole active tab's close action, while the open-tab list reaches hidden tabs.
- The second 40px row contains current-page Back/Forward/source return and the
  existing search/Filter, locate, refresh, Display and inspector controls.
  Double-click/Enter opens a card inside that page; its label stays unchanged.
  Detail uses its result's filmstrip. Independent result-root Escape closes its
  tab. Card context-menu Open in new tab reuses the supplied mock result.
- Private query, selection, history, display and editing state survive tab
  switching. Active close returns to the most recently used remaining page;
  background close preserves the foreground; final close restores empty workspace.
- Display now keeps cover-only separate from enabled information choices.
  Rest hides the overlays; hover or keyboard focus restores the configured
  overlays. A no-cover card retains its icon and identifying name.
- Simulated save failure marks the owning tab without activating it. Its marker
  opens an entry to the original field. Failed edits block close until recovery
  or explicit draft discard. Existing conditional-save demonstrations remain
  approximate UI behavior, not database correctness evidence.
- Tasks, notifications and Settings remain global modals. Task View has a
  deliberate one-second presence-read simulation; dismissing the modal abandons
  it. Reopening does not revive that View. Current success creates one independent
  detail tab before dismissing the modal. Import example adds a completed mock
  record without opening the task surface.
- Media has two illustrative Image fixtures; All content also includes the eight
  Model fixtures. A referenced Model cover does not make that Model a Media item.
  Tags is a minimal singleton navigation fixture retaining its selected root.
  It is not the complete Tag editor. Settings is a placement/lifetime sample,
  not working library configuration. No file picker or actual import is invoked.

The footer's Scenes entry creates eight tabs or a long-title result and retains
the original latency/failure/conflict controls. Native window buttons are a
clearly labeled noninteractive reserved region. Actual drag regions, Electron
window operations, browser history integration and production page lifetimes
must be verified in the real application.

### Bounded verification

The in-app browser exercised the actual viewport plus 1280 by 720 and 720 by 480
CSS-pixel layouts. The browser was zoomed to 130%; temporary viewport overrides
were calibrated against CSS layout metrics and reset afterward. Raw browser
captures preserve that zoom without rescaling the image. Current evidence:

- `chrome-current.png`: user-facing viewport, models and stable tab strip.
- `chrome-desktop.png`: 1280 by 720 CSS pixels with the inspector open.
- `chrome-narrow-overflow.png`: 720 by 480 CSS pixels with many tabs and a long
  standalone title; native control space and active close target remain visible.
- `chrome-empty.png`: final-tab-close empty workspace with global task access.
- `chrome-attention.png`: retained failed field and blocked close with its tab marker.

Observed checks: independent empty/Pony queries; grid/detail Back/Forward/source
return without tab renaming; Task View dismiss/reopen produces only the latest
receiver; result-root Escape returns to the MRU page; background close preserves
the foreground; final close leaves Tasks reachable; cover-only keeps Title
enabled, hides/restores by focus and remains private; no-cover name survives;
failed autosave does not activate its page, explicit attention entry locates the
field, failed close retains both tabs and retry clears the issue; Settings Escape
closes only its modal; repeated Tags entry keeps exactly one tab and its selection.

The first pass exposed preexisting SVG-symbol/button ID collisions, a cropped
active close button, a one-pixel native-placeholder overflow and an unnamed
icon-only Display button. These were corrected and the affected checks repeated.
Final narrow document width is exactly 720 CSS pixels and the entire active close
target is within the tab strip. Script syntax and unique static IDs pass; browser
error logs were empty during the final flow checks.

One design-detector pass retained warnings for the incumbent Geist family and
the intentionally full-height search/Filter segment required by `rules/ui.md`.
Its dialog border-plus-shadow advisory was fixed by retaining only the border.
No new brand identity or token system is selected; DESIGN.md remains unchanged.
Per repository UI-iteration rules, verification is bounded local inspection,
without extra subagent acceptance gates. This does not settle production WV checks.

## Historical model-only specimen

The following records the preceding 2026-10-04 sample. Current behavior above
supersedes its preopened tabs, destructive cover-only switch, icon-only missing
artwork and global-versus-private display uncertainty.

### What the preceding version demonstrated

- Locus opens another independent model tab. The initial Pony tab has its own
  search. Selection, grid scroll, visibility and drafts are private to each tab;
  simulated saved model values are shared.
- Cards are 240 by 320 CSS pixels with cover cropping and 8px corners. White
  title and version text sits on a 76% black footer. Model type and family sit
  together at the cover's top left, each on its own 76% black rectangle with
  4px corners. Titles clamp to two lines; version uses one.
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

The follow-up `classification-top.png` shows the user's proposed type/family
placement at the cover's top left, in the current 841x958 CSS-pixel viewport with
the inspector closed. Classification labels are inset 12px and the default
one-line-title footer is 64px tall. Card size remains 240x320. Toggling cover-only
removes both top and bottom overlays; restoring defaults restores seven
classification rows and eight footers without duplicate labels. The earlier
screenshots below retain the preceding bottom-classification layout as history.

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

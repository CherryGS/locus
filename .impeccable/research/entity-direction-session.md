# Entity foundations direction session

Status: direction selection suspended because the generated samples do not
faithfully represent the existing UI logic. No visual identity is approved.

## Fidelity correction, 2026-10-03

The user asked what the new sample was intended to reference and pointed out
that its UI logic differs substantially from the existing application. The
intended comparison was palette, typography, boundaries and control weight, but
the generated samples also invented or rearranged information and affordances.
The main agent withdraws them as implementation references. This is not a user
rejection of every visual property in the second hand and is not a choice of
another direction.

Resume from the actual renderer and its governing interaction contracts. Present
appearance changes on the same real screen and content so the change is legible.
Discuss any proposed information architecture, layout or interaction changes
separately; do not smuggle them in as visual styling. Do not request selection
from the current generated hand or treat its decision-page buttons as the next
implementation step. The existing page is an archived exploration only.

## User feedback, 2026-10-03

- Establish the global dark visual system first; light has substantially less
  applicability for this user. Remove light directions from subsequent rounds.
- The user described all presented directions as nostalgic, dated WPF styling.
  Do not treat any card, its colour scheme or its component framing as approved.
- The working diagnosis is excessive panel framing, heavy toolbar bands,
  repeated dividers and decorative selection treatments. This is an interpretation
  to test against the next concrete design, not a new user-approved aesthetic.
- The application already uses dark renderer tokens, an HTML dark class and
  Electron's dark native theme. The remaining task is the visual language,
  not adding a light/dark switch or another preference owner.
- Revised scope and proposed direction: `dark-foundations-brief.md`.
- The user tentatively named Eagle and explicitly asked work to continue while
  seeking other references. Do not treat it as an approved design or import its
  behavior. Do not repeat the dominant-workflow question.

## Archived dark-only hand

- Original seed `75117ec9`, re-roll 1, assigned grounded candidate 5.
- Candidate reasoning: `dark-direction-r1.md`.
- Payload: `entity-decision-75117ec9-r1.json`.
- Existing decision URL and key are reused: `http://127.0.0.1:63515/`, `7fb55f3c`.
- Comps: `.impeccable/mocks/decision/75117ec9-r1/` (assigned, model-pick, canon).
- All cards are dark; changes explore typography, density and control weight.
- Image producers use `gpt-6.1-sol` with `high` reasoning per the user's new default.
- Selection is suspended on UI-fidelity grounds. All sidecars remain unapproved.
- All three native comps are complete, each with one bounded correction pass,
  prompt provenance and `approved: false`. The actual output is 1586 by 992.
- Main-agent visual inspection confirms dark UI and text/file preview surfaces,
  larger media presence, no duplicate Inspector preview or metadata accordions,
  and no large action footers. Natural media keeps its own colours.
- Remaining illustration drift: the navigation rail, type and Inspector are
  larger than requested; the alternatives differ less in density than intended;
  faint vignette/gradients remain despite the flat-surface brief. Some metadata
  and note-preview text are synthetic. These are not new functional requirements
  or approved sizing/material decisions. Do not claim an implementation or
  accessibility pass from generated pixels.
- Candidate primary/secondary text pairs were checked numerically against their
  intended Inspector grounds: primary contrast 13.42–15.40, secondary 6.58–7.50.
  The raster output and later implementation require their own verification.

## Archived first hand

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

Do not resume waiting for an answer to the rejected hand. If a subsequent visual
round is requested, reuse the existing decision session as the skill describes,
with updated constraints and new imagery; do not reopen the rejected proposals
as candidates. No production implementation follows from the rejected hand.

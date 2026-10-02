# Dark foundations: revised brief

Status: confirmed scope and rejection, with a proposed visual response.
Mode: Operate. This is working material, not an approved DESIGN.md.

## Confirmed

- Establish the global dark visual system before advancing individual screens.
- The first comp set feels like dated WPF software to the user and is rejected.
- Work incrementally across connected workflows. No highest-priority workflow
  is required, and existing shadcn defaults have no approved visual authority.
- Existing product facts, interaction contracts and asynchronous stability remain
  binding. Language support must accommodate Simplified Chinese and English.

## Existing implementation evidence

- `apps/desktop/src/renderer/index.html` applies the dark class before render
  and declares a dark colour scheme.
- `apps/desktop/src/renderer/app/styles.css` supplies dark global tokens.
- `apps/desktop/src/main/application.ts` selects Electron's dark native theme
  and a dark initial window background.
- A new theme preference or backend change is not needed for the confirmed scope.

## Proposed visual response

- Use a neutral near-black workspace with a small number of clearly separated
  surface levels. Avoid broad blue-grey bands, bevels, simulated materials and
  decorative gradients.
- Group primarily with spacing, alignment and typography. Reserve visible
  boundaries for editable controls, resize seams and genuine overlays; do not
  nest framed panels inside framed panels.
- Let media lead. Keep card captions short, and put actions beside the object
  or field they affect. Remove oversized footer/action blocks as each affected
  component is revised.
- Use one restrained interaction accent with independent error/warning semantics.
  Selected, hovered and keyboard-focused states must be distinct and readable;
  do not dim secondary text below readable contrast to manufacture hierarchy.
- Keep inspector metadata directly visible, with clear headings and aligned
  field rows. Do not add accordions or replace values with success messages.

## Next bounded sample

The user tentatively named Eagle, noted they cannot currently open it because
their trial expired, and explicitly asked work to continue while they seek more
references. This does not pin Eagle's design or authorize importing its features.
Inspected its official overall UI and Inspector images in the
[Eagle 4 announcement](https://eagle.cool/blog/post/eagle4). Useful observations
are compact chrome, direct image/caption groups and closely associated property
actions. Its blur, duplicated preview and disclosure behavior are not adopted.

Demonstrate the shared shell, media card and Inspector together in a dark-only
sample. Compare
surface hierarchy, density and control weight, rather than tinting the same
layout multiple colours. Exact palette, font, radii and accent are still open.

The revised direction hand is recorded in `dark-direction-r1.md` and
`entity-decision-75117ec9-r1.json`. It uses the original seed/session with re-roll
1; all previously presented directions are eliminated, and the conventional
alternative is dark too. Each declared slot receives a fresh native-generated
image after the page update.

No production files changed in this feedback checkpoint, and none of the first
hand's image sidecars gains approval. A later implementation should be verified
in the actual isolated renderer under the repository UI rules.

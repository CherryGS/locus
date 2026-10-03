---
name: Locus
description: A quiet, refined dark desktop interface with media-led browsing and moderately compact information surfaces.
components:
  entity-grid-toolbar:
    height: "40px"
---

# Design System: Locus

## Overview

**Status: directional baseline v0.1.** On 2026-10-03, the user confirmed a quiet,
refined global interface, media-led browsing, and moderately compact properties,
tables and settings. The dark visual system is an existing commitment.

Shared foundations and real component exploration advance together. This file
is usable before all components or tokens are settled. It does not describe a
completed implementation. The current shadcn defaults and rejected historical
samples do not establish the selected palette or component appearance.

The [first renderer candidate](.impeccable/research/visual-foundation-v01.md)
applies concrete palette, type and control choices to shared primitives and
settings rows, together with the user's grid alignment, contrast and toolbar
feedback. Palette and type choices remain trial values while those details below
are open. The selected, verified 40px browsing toolbar is recorded in the
frontmatter; this does not finalize the whole application's visual identity.

- **Selected direction** records explicit user choices.
- **Working guidance** interprets that direction for the next component trials;
  refine it with evidence from the actual renderer.
- **Open details** require a concrete candidate and validation. Resolve only
  those needed by the current work; unrelated work can continue.

Product truth remains in [PRODUCT.md](PRODUCT.md). Interaction and information
contracts remain under `project-doc/design`; [UI rules](rules/ui.md) govern
visibility and stable updates. Visual changes preserve these contracts.

**Key Characteristics:**

- One quiet, refined language for shared interface elements.
- Media receives visual prominence where people browse or inspect media.
- Information surfaces balance scanning efficiency and comfortable reading.
- Shared rules evolve through small, connected examples in the real app.

## Colors

**Selected direction:** dark across the application in this design round.

**Working guidance:** distinguish the application background, grouped surfaces,
controls and overlays through deliberate tonal layers. Establish legible primary,
secondary and supporting text roles. Use emphasis to clarify selection, focus and
important actions; give operation outcomes consistent semantic treatments. Media
retains its own colors and remains the visual subject in browsing surfaces.

**Open details:** neutral hue and tonal ramp, accent hue and distribution, exact
text/border/status values and contrast in real component states. Numeric color
tokens will be recorded when chosen and verified; existing CSS values remain
implementation evidence while this selection is open.

## Typography

**Working guidance:** use calm, readable interface typography with coherent
Chinese and Latin coverage. Make page titles, group headings, labels, values and
supporting text distinguishable through a small hierarchy. Compact information
remains readable; quieter metadata still needs sufficient contrast. Use a
monospaced role where identifiers, paths or expressions benefit from it.

**Open details:** font families and fallback order, role sizes and weights, line
heights and truncation/wrapping treatments within existing information contracts.
The currently imported Geist face is not a confirmed replacement-system choice.

## Layout

**Selected direction:** vary density by surface while retaining one global
visual language. Media browsing gives previews visual prominence. Properties,
tables and settings are moderately compact and support quick scanning.

**Working guidance:** use consistent alignment and a shared spacing rhythm for
related controls. The user selected centering the media grid as one block when
its width cap leaves spare space, preserving the existing inter-card gap; this
does not center the Tag column browser. Preserve usable content bounds, reading
space and keyboard focus. Changes in density must preserve ordinary facts and
available actions.
The existing page composition remains functional evidence; the density direction
alone does not authorize new navigation, information hiding or interaction flows.

**Open details:** spacing scale, control/row heights, preview-to-text proportions
and behavior at narrow desktop window sizes. Verify shared rules using both a
settings composition and a media card before expanding their application.

## Elevation & Depth

**Working guidance:** use quiet surface layering and restrained boundaries to
communicate grouping. Overlays should be clearly distinct from the surface below
them. Focus, selection and errors must remain easy to perceive in the quiet
interface. Compare depth treatments alongside neighboring surfaces.

**Open details:** tonal separation, border strength, overlay shadows and whether
particular surfaces need a shadow at all.

## Shapes

**Working guidance:** related controls share a consistent form language; grouped
surfaces and overlays use a coherent radius relationship. Determine shapes across
representative consumers rather than giving each component its own treatment.

**Open details:** radius scale, border widths and icon/control proportions.

## Components

**Selected direction:** shared navigation, dialogs, buttons and inputs belong to
the quiet, refined global system. Media prominence and compact information are
surface adaptations of that system.

**Working guidance:**

- **Entity browsing toolbar (selected):** use a compact 40px toolbar with an
  ordinary-size page title, adjacent result/selection metadata and right-aligned
  Filter/refresh actions. Omit the duplicate grid icon. Keep the inspection
  filmstrip under its existing presentation and interaction contract.
  Align title, result count and selection metadata using the same text size and
  line height; count-badge padding must not offset its text from that center.
- **Settings:** retain Raycast as the scoped reference for shared groups and
  rows: quiet grouped surfaces, aligned labels and controls, and consistent help
  and action placement across Library, External connection and Media tools.
  Adapt columns and padding to the settings content width. Stack labels above
  controls when two columns would constrain them, and give consequential action
  explanations enough width before placing an adjacent button.
  Give the library path the full group width, with its source as quiet metadata
  and the switching action beside the group heading. Keep the path selectable
  and allow long paths to wrap without truncation.
  Put application restart in the persistent Settings dialog header, shared by
  all categories. Present search index status and maintenance actions in one row;
  normal status updates automatically, with explicit reread only after failure.
  Show published document count and searchable segment data size in the index
  row, keeping progress and failure separate from these retained statistics.
  Settings rows use aligned labels and values at ordinary desktop content widths,
  stacking at narrow widths. Keep Token reset consequences beside its action in
  the full group width; reveal/hide does not need a separate success message.
- **Media cards:** emphasize the preview, with readable titles and metadata and
  clear existing actions and selection. Keep hover, selection and keyboard focus
  distinguishable through quiet boundaries; preserve card geometry and the grid
  spacing. Inspect with representative real content.
- **Properties and tables:** favor stable alignment and readable values. Preserve
  the visibility of identifiers, dates, status and other ordinary facts. Use
  ordinary-case section headings, supporting labels and primary-foreground values
  to separate hierarchy without fading the content. Reflow narrow property rows
  while retaining directly visible, selectable fields.
- **Native text selection (selected):** identifiers and other read-only inspector
  and Settings values, including Filter field references, remain ordinary
  selectable text. Provide no dedicated copy
  button or click/keyboard clipboard handler. Users select text and copy through
  the platform's Ctrl+C or context menu. Preserve normal input editing, Token
  masking/reveal and existing link navigation. Do not add hover/focus copy states,
  clipboard feedback, extra tab stops or a generalized literal-copy mechanism.
- **Shared controls:** compare default, hover, focus, active/selected, disabled,
  pending and error states where applicable. Apply shared choices through the
  existing primitives and semantic tokens, preserving behavior.
- **Filter workspace:** keep presets secondary to the raw query. Use the darker
  control surface and monospace text for source, with compact query actions and
  directly visible, clickable diagnostics. Separate the optional field reference
  with a heading rhythm and aligned types, without row actions. Keep the footer
  reachable while the editor and reference scroll independently in short windows.
  Omit visible dialog headers, draft-state badges and duplicate option labels.
  Start Filter with preset controls and preset selection with search; keep Close
  in that first row. Preserve accessible dialog names, input labels and the
  confirmation/error information needed for actual operations.
  Keep preset loading, renaming and deletion together in the chooser, with
  management actions on each record. Managing a different record must not load
  it or replace the current draft/result. Close the chooser before opening name
  or delete confirmation, and preserve focus handoff. Omit the separate options
  menu. The chooser permits outside interaction and closes when focus moves to
  another control; preserve that control's focus instead of restoring the trigger.
  Escape and explicit Close return to the preset trigger.
  Show manual index maintenance directly in Library settings; current Filter
  index errors retain their inline recovery actions.
- **Tag navigation and editing:** wrap Up/Down focus within each tag column at
  its ends, preserving the existing explicit activation behavior. Entering
  description editing changes readonly mode on the mounted Markdown editor,
  preserving its code blocks and using its normalized text as the draft baseline.
- **Refresh continuity:** retain established content and empty states while
  rereading. Keep refresh controls and their icon nodes stable, preserve keyboard
  focus while blocking duplicate requests, and show visual activity only when a
  read lasts long enough to warrant it. Retained previews remain qualified by
  their actual input and observed bytes; a changed or removed input updates the
  presentation, and a failed refresh remains visibly attributable.
  Notes autosave and saved view choices omit routine success labels. Keep pending,
  unsaved, failed and uncertain operation feedback visible where it belongs.
  Keep the autosave hint inside the Notes input surface as a separate footer,
  without covering editable text. Associate connection availability with the
  active HTTP endpoint.
  Group the active HTTP endpoint, editable bind address and Token in one HTTP
  surface. Keep address saving and Token operations independent inside that group.
- **Utility panels:** Tasks, Notifications and the tag chooser start with one compact toolbar;
  merge filtering, search and panel actions instead of reserving a separate title
  row. Keep accessible names and allow controls to wrap in narrow windows.
  Preserve consequential confirmation headings and the Settings restart toolbar.
  Empty Notifications uses a single compact content row with inline Close;
  omit the unused filter toolbar and divider when there are no records.
- **Task feedback:** give search, state filters, refresh and Close one toolbar.
  Give record names priority in the list, with compact accessible status icons;
  active work and attention may coexist. Keep progress scoped to its execution
  stage and preserve business-result wording independently of execution ending.
  Show import failure causes beside recovery actions. Flatten the details surface
  within each item and keep its history and disclosure state during updates.
  Avoid a second boxed recovery warning inside an item; keep the cause, concise
  recopy consequence and action together. Align processing step names with their
  observed states and reasons. Omit the redundant Finished badge in record details.
  Preserve the result-refresh icon, bounds and focus through rereads, deferring
  visual activity for brief requests and blocking duplicate activation.
- **Notes feedback:** keep the status and icon footprint fixed. Defer short-lived
  Saving/Loading feedback using the shared pending threshold; retain the observed
  text and textarea appearance during a quick reread. Show Unsaved and
  errors immediately, and qualify a slow retained read as Refreshing. Preserve
  autosave timing, draft ownership and confirmation behavior.
- **Empty and failed reads:** distinguish an observed empty result from a failed
  first read and a failed refresh. Show the available next action at that state;
  keep prior results visibly qualified during refresh recovery. In Overview,
  separate the cause, recovery action and affected data with ordinary headings
  and compact spacing. Let long diagnostics and retry labels wrap in narrow panels.
  Empty states state the missing content or next action once. Omit descriptions
  that repeat their title or adjacent action. Keep diagnostic text, affected
  identities and qualification of retained data visible during read failures.

**Open details:** the actual component variants, numerical tokens and motion
treatments. No component is considered visually accepted solely because this
baseline exists.

## Do's and Don'ts

- **Do** start scoped work from the selected direction and current shared rules.
- **Do** mark experimental values as candidates while related choices are open.
- **Do** promote accepted, verified component choices into this shared baseline
  and the corresponding implementation tokens. Check representative consumers
  when a shared rule changes; do not expand a local preference automatically.
- **Do** keep existing content, focus, selection and scroll stable during updates.
- **Don't** require every token or component to be settled before using the skill
  for a bounded refinement or exploration.
- **Don't** treat framework defaults, historical mockups or an unreviewed candidate
  as user approval.
- **Don't** generalize the settings-only Raycast reference into a global reference
  or turn a visual-density choice into a product-workflow ranking.
- **Don't** hide ordinary information or change behavior to make a screen quieter.

As concrete choices settle, add the actual color, typography, spacing, shape and
component tokens to the frontmatter. Generate `.impeccable/design.json` from the
realized system for live component previews; this directional baseline does not
invent a token catalog or claim a completed live preview.

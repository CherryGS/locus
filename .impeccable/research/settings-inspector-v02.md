# Settings and inspector refinement v0.2

Status: working renderer checkpoint, within the selected dark foundation.
Date: 2026-10-03.

The user authorized the next connected refinement of Settings, Entity properties
and media-card states. This preserves the existing content, operation owners and
navigation contracts. The concrete values below remain revisable candidates.

## Layout and hierarchy

- Settings padding follows the workspace container: 16px ordinarily, 32px above
  576px of available workspace width. Shared rows use stacked labels below a
  512px group width; wider groups use a 144px label column and a 24px column gap.
- Token reset effects remain visible at the action. Below a 672px group width,
  the full-width explanation precedes the right-aligned button. Wider groups
  place them side by side without compressing the paragraph to a narrow strip.
- Inspector section headings use 13px medium text in ordinary case. Labels use
  readable supporting 12px text; ordinary values use primary 13px text. Copyable
  identifiers retain their monospaced 12px role and now use primary foreground.
  Existing narrow-container property stacking remains in place.
- Media-card captions have a restrained separator and tabular numerals. Hover
  uses the input boundary; selection uses the primary outline, with full primary
  emphasis when keyboard focus is in the grid. Card height, preview allocation,
  title/summary slots and inter-card spacing remain unchanged.

## Evidence

- Type checks and the desktop build passed. The layout detector reported no
  findings over the scoped settings rows, property fields and card composition.
- Real renderer over the retained isolated comprehensive library was inspected
  at 1200x800, 720x650 and the actual 842x958 browser viewport.
- At 1200px, editable settings used 144px/534px columns; the Token explanation
  had 368.6px of width and occupied one 20px line. At 720px, editable settings
  used one 348px column and the explanation occupied two 20px lines. Neither
  workspace had horizontal overflow. Library paths and Media tools were also
  inspected at the narrower width.
- The empty-address validation remained visible, Save stayed disabled, and the
  disposable draft was discarded. Tab from ffprobe reached ffmpeg. No save,
  reset, Token reveal or restart operation was executed during manual inspection.
- The Image inspector retained every property and identity at a 192px minimum
  width without horizontal overflow; rows stacked. At its ordinary 320px width,
  rows used aligned label/value columns. Values measured 13px and headings had
  no uppercase transform.
- Cards retained 216px height and 12px gaps. Selection and image content remained
  attributable to the same Entity throughout panel navigation and resizing.

Screenshots and measurements are retained locally under
`E:/Project/locus/.local/visual-foundation-v01/`. These checks support this bounded
refinement; they do not establish a complete accessibility or performance audit.

## Copy-control feedback

The user subsequently requested less copy-icon repetition, vertically centered
icons and space between highlighted controls and their text. The shared identity
copy button now centers its icon, extends the highlight 6px past the aligned text
on each side, and reserves the same icon footprint across states. Idle icons are
shown on hover and keyboard focus; non-hover input retains the icon. Copy results
remain visible, and the value stays present.

Actual Image inspector measurements at 320px and 192px widths showed no horizontal
overflow, zero difference between text-block and icon vertical centers, and 7px
between the text and the highlighted left edge including the border. Idle mouse
icons had zero opacity; hover and keyboard focus had full opacity. Space copied a
fixture File ID successfully, retaining its value and 42px two-line control height.
Type checks and the desktop build passed for this correction.

# Visual foundation candidate v0.1

Status: working renderer checkpoint; technically checked. Palette and type
choices remain open to component-level feedback.
Date: 2026-10-03.
Basis: the combined direction in `DESIGN.md`, confirmed by the user.

This is a concrete first trial for the shared foundation and representative real
components. The palette and numerical choices below are candidates, not new
brand commitments. Accepted choices can be promoted into `DESIGN.md` and its
token frontmatter; revisions can be explored within the existing direction.

## Implementation

Use deeper graphite surfaces with a desaturated green accent. Distinguish shell,
content groups, controls and overlays tonally. Soften primary text and reduce
metadata prominence while retaining readable contrast.

| Role | Candidate |
| --- | --- |
| Workspace | `#111315` |
| Navigation shell | `#171a1d` |
| Card / settings group | `#1a1d20` |
| Overlay | `#1f2327` |
| Input surface | `#15181b` |
| Primary text | `#e8ebed` |
| Supporting text | `#b0b8be` |
| Primary action / focus | `#aac9bc` |
| Primary action text | `#14251e` |
| Error | `#ef9694` |
| Group boundary | `#30363b` |
| Input boundary | `#414a50` |

- Keep the installed Geist face and add explicit Chinese UI fallbacks. Use
  Cascadia Code / SFMono-Regular / Consolas for the existing monospaced roles.
- Shared small interface text is 13px with 20px line height; card supporting
  text is 12px with 20px line height. Entity browsing uses a compact 40px toolbar
  with an ordinary-size title; result count and selection metadata sit together
  on the left, Filter and refresh on the right. Remove the duplicate grid icon.
  Other page headings and the inspection filmstrip retain their existing sizing.
- Controls use 6px corners, cards/groups 12px. The shared radius scale is
  4/6/8/12/16/20/24px.
- Retain existing button and input bounds; ordinary inputs remain 32px high.
  Settings rows use 12px vertical padding and a 56px minimum height. Center the
  media grid as one block when its card width cap leaves spare horizontal space;
  retain the 12px inter-card gap and existing card geometry.
- Outline controls share the input surface; ghost controls inherit their
  surrounding text role and use tinted hover/expanded states. Content labels
  such as Tag names therefore keep the main foreground rather than adopting
  the auxiliary chrome color. Tag counts use readable supporting text, with
  full primary-action foreground on selected rows. Keyboard focus uses a distinct
  border and a 2px ring. Color transitions take 150ms and honor reduced motion.
- Remove the button press translation. Theme text selection, caret and native
  scrollbar colors from the shared palette.

Production scope: global `app/styles.css`, shared Button/Input/InputGroup/Card
presentation, shared settings groups/rows, Entity browsing toolbar/grid alignment
and Tag count presentation. Card metadata changes also reach the Civitai card
consumer.
Existing content, card geometry, inter-card spacing, navigation, data selection
and operation behavior are retained.

## Verification

- `just desktop-check`: passed.
- `just desktop-build`: passed.
- `git diff --check`: passed.
- Implementation structural validation for `webui/architecture`,
  `webui/settings-workspace` and the Electron renderer ADR closure: passed.
- Real renderer over the retained comprehensive sample library: inspected at
  1200x800, 720x650 and the actual in-app browser size, 842x958.
- Library, External connection and Media tools share the group/row treatment.
  Narrow settings stack labels and controls; inspected views had no page-level
  horizontal overflow.
- Keyboard grid navigation and selection, Chinese media titles, ffprobe-to-
  ffmpeg Tab focus, invalid empty input and disabled Save were exercised. The
  test draft was discarded; no settings save/reset operation was executed.
- After the user's layout feedback, the 745px media viewport had equal 46.5px
  side margins; with Overview open, the 415px viewport had equal 47.5px margins.
  The measured gap remained 12px and the row height 216px in both cases.
- After the user's contrast feedback, actual Tag rows showed main text
  `rgb(232, 235, 237)` and supporting counts `rgb(176, 184, 190)`; selected labels
  and counts shared the full primary-action foreground. ArrowDown moved focus
  from Images to Models while keeping Images selected, preserving the existing
  distinction between keyboard focus and selection.
- The user accepted the compact browsing-toolbar proposal. The realized toolbar
  measures 40px, with a 13px/500-weight heading and adjacent result/selection
  metadata. Filter opens and closes, Refresh retains the established list and
  selection, and Enter inspection / Back still return to the selected Entity.
  The existing inspection filmstrip measures 88px and was not resized.
- Initial token-pair checks passed, but the user observed that Tags content was
  too faint: the first ghost variant assigned all consumers the supporting text
  role. The revised variant inherits the appropriate surrounding role instead;
  supporting text is brighter and selected Tag counts no longer reduce opacity.
  Verify rendered content and state pairings as well as standalone palette
  tokens. These checks do not constitute a complete accessibility audit.

Screenshots and token-pair measurements are retained locally under
`E:/Project/locus/.local/visual-foundation-v01/`. The live isolated preview is
served from `http://127.0.0.1:58353/`; its lifetime belongs to this trial session.

## Next decision

Continue concrete component refinement and shared foundation work together.
Promote individual numerical choices into `DESIGN.md` as the user selects them;
keep other palette, type and surface decisions revisable. A Git checkpoint of
the working renderer does not establish approval of every candidate token or
prevent further visual iteration.

# Shared settings rendering

Date: 2026-10-03. The user selected Raycast as the reference for this bounded
settings component pass. Screenshots document the implementation, not subsequent
visual approval.

- Library, External connection and Media tools use one section, row and action
  family. Matching group width, heading treatment, control column, help placement
  and utility actions replace the independent Card/row implementations.
- The screenshots come from the real renderer against an isolated temporary
  library. `library.jpg`, `external.jpg` and `media.jpg` use the same 1280 × 720
  viewport; `media-narrow-edit.jpg` uses the desktop minimum of 720 × 480.
- The initial narrow check found header reflow when a dirty badge appeared.
  Moving edit/restart state below the fields and reserving scrollbar space fixed
  it. `layout-check.json` records identical input bounds before and after the
  first edit, with focus retained.
- Empty Media paths and the listener address show linked field errors and disable
  Save. Discard restores the observed values. Current runtime paths stay visible
  while editing. Help opens with Enter and closes with Escape. Token stays masked.
  Verification drafts were discarded and the viewport override was removed.
- Typecheck, renderer build and the 24 tests in `settings.test.mjs`,
  `settings-workspace.test.mjs` and `external-settings.test.mjs` passed. Scoped
  implementation structure validation passed; Impeccable detection returned no
  findings. The final preview had no captured console errors. Existing route
  generation circular-dependency and bundle-size warnings remain.
- Library selection and application restart require the native desktop host and
  were not exercised in this browser preview. Their handlers, reset guards,
  credential behavior and coordinator contracts were preserved.

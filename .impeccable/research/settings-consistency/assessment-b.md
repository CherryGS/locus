# Assessment B — detector and browser evidence

Target: `apps/desktop/src/renderer/features/settings/ui/settings-panel.tsx`, with Library, External connection and Media tools children.

Method: isolated Assessment B agent `/root/settings_evidence_review`. No Assessment A report or parent taste judgments were read. Product context came from `PRODUCT.md`, UI constraints from `rules/ui.md`, and the workflow from `.agents/skills/impeccable/reference/critique.md`. Context initialization had already run in the parent and was not repeated.

## Deterministic detector

Actual command, from `E:/Project/locus`:

```text
.agents/skills/impeccable/scripts/impeccable.cmd detect --json apps/desktop/src/renderer/features/settings/ui
```

- Exit code: **0**.
- Complete stdout JSON: **`[]`**. Saved as sibling `detector.json`.
- Findings: **0**. Rule names: **none**. Reported file locations: **none**.
- False positives: **none reported**, because there were no findings to adjudicate.
- Narrow scan directory contains five TSX files: `settings-panel.tsx`, `settings-rows.tsx`, `library-settings-panel.tsx`, `external-access-panel.tsx`, `media-settings-panel.tsx`. The CLI does not print a processed-file count in this JSON output; five is the directory inventory, not a fabricated detector counter.
- `.impeccable/critique/ignore.md` was absent. No prior critique was consumed.

A clean detector result does not establish consistency between sibling screens. The directly observed composition differences below remain evidence even though no detector rule reported them.

## Browser method and fallback

Created an independent fresh **hidden IAB tab** at `http://127.0.0.1:53185/#/entity`, opened the **Setting** control, and visited External connection, Library and Media tools through their category buttons. Observed native browser screenshots and accessibility trees, then used the documented CUA read-only DOM evaluation for geometry and computed styles.

**No overlay or injection was performed.** CUA documents `playwright.evaluate` as a read-only page scope. Mutable title/script preflight therefore is unavailable under this API; no unsupported mutation was attempted, no detector JS was injected, no raw Playwright/Selenium workaround was used, and no Impeccable live server was started. Browser detector console findings are **not available**, rather than zero. The explicit workflow fallback is CLI output plus source review and manual browser observations. Browser visibility remained hidden; there is no user-visible `[Human]` overlay.

The existing preview server was reused and left running. The evidence tab was explicitly closed after inspection. No settings, credentials or library selection were changed. Token remained masked; its value was excluded from DOM evaluation outputs. Reset, save, discard, restart, token reveal/copy and library selection actions were not invoked.

## Measured composition

Observed screenshot viewport: **1280 × 720**. The settings dialog measured **1152 × 648** at `(64,36)`. The common workspace measured **928 × 599** at `(288,85)`. Every category shares the 800px outer content container with 32px side padding, producing a **736px** usable content width. All top titles begin at **x=384, y=109**, and all use **20px / 28px line-height, weight 600**. Restart application stays at **x=970.31, y=109**, measuring **149.69 × 28** in every category.

| Property | Library | External connection | Media tools |
|---|---|---|---|
| First group origin | `(384,157)` | `(384,177)` | `(384,157)` |
| First group width | 736px | 736px | 576px |
| First group height in observed state | 130px | 378.25px | 207px including outside header |
| Group title | Current library | Connection details | Tool paths |
| Group title size / weight | 16px / 500 | 16px / 500 | 14px / 500 |
| Group title position | Inside card, `(400,173)` | Inside card, `(400,193)` | Outside field surface, `(384,161)` |
| Main group surface | Opaque card background | Opaque card background | Header has no surface; field box uses card background at 50% opacity |
| Group edge | 14px radius; foreground ring | 14px radius; foreground ring | 14px radius; 1px border at 60% of border token |
| Row decoration | No per-row icon; library path and actions stacked | 28px muted icon tiles for address/token/edit row | No icon tiles; 72px fixed label column |
| Help trigger | After library action, 28 × 28px | Inline description and field hints; action titles | Beside section title, 24 × 24px |

External's first group begins 20px lower because the shared header adds the 16px introductory line and 4px gap only for External connection. This is a source-confirmed content difference, not a broken top-title alignment.

**Key reproducible structural difference:** Media tools ends at **x=960**, while Library and External card surfaces end at **x=1120**. The shared Restart application button still aligns to x=1120. The Media header/reset controls, field surface and form therefore occupy a narrower subordinate column by **160px**, despite using the same overall workspace. Its group title sits outside the surface and is two pixels smaller. These are composition differences, not different shared Input or Button designs.

## Inputs and actions

All inspected inputs use the same base treatment: **32px height**, **14px text / 20px line-height**, weight 400, **10px radius**, **4px 10px padding**, background `oklab(1 0 0 / 0.045)` and border `1px solid oklch(1 0 0 / 0.15)`.

| Input | Width | Position | Semantics |
|---|---:|---|
| Current Token | 192px | `(816,313.5)` | Read-only password input; masked |
| Saved address | 214px | `(890,462.875)` | Editable text input |
| ffprobe | 458px | `(485,212)` | Editable text input |
| ffmpeg | 458px | `(485,295)` | Editable text input |

The longer media fields are compatible with executable paths. Width differences alone are not sufficient evidence of a defect. The parent can separate this justified field sizing from the surrounding group-width/title/surface differences.

Shared small outline actions (Restart application, Choose library and restart, Reset shared Token) consistently measure **28px height**, use **12.8px / 18.29px text**, weight 500, and **8px radius** with the same translucent background/border. Ghost icon actions consistently measure **28 × 28px**, except the intentionally selected `icon-xs` media-help trigger at **24 × 24px**. The tiny help target is an observed size difference; no claim is made that desktop controls must satisfy a mobile 44px threshold.

Action placement differs in the default state:

- **Library:** Choose library and restart is inside the card below the path, at `(400,243)`; its help control follows immediately. Global Restart application remains above the card.
- **External:** address/token copy and refresh actions sit next to their values. Reset shared Token is outline and right aligned in its own explanatory row, at `(950.56,373.5)`. Restore default address is ghost and lower left, at `(400,511.25)`.
- **Media:** Reset and Reload / recover are ghost controls at the upper right of the outside Tool paths header, at `(857.22,157)` and `(932,157)`.

No Save/Discard row was visible in either observed pristine form. Source-only evidence shows the order differs: External puts **Discard address edits then Save address**; Media puts **Save then Discard edits**. This conditional state was not exercised because the review was read-only. Both sources communicate unsaved/restart-required states, but async/error stability was not tested here.

## Source anchors

Paths below are relative to `apps/desktop/src/renderer/features/settings/ui/`:

- `settings-panel.tsx:38`: common `max-w-[800px]`, `gap-5`, `sm:px-8` content container. Lines 40–70 establish shared top title/header/restart action. Lines 51–57 add External's description.
- `settings-rows.tsx:14`: `SettingsGroup` wraps Library/External in shared Card/CardHeader/CardContent. Line 41 defines the icon tile; line 51 defines SettingsRow; line 75 defines SettingsEditRow. Line 103 sets edit-input responsive width.
- `library-settings-panel.tsx:41`: uses SettingsGroup. Lines 61–76 stack the library root and choose action; line 80 uses `icon-sm` help.
- `external-access-panel.tsx:77`: uses SettingsGroup. Line 85 uses SettingsRow; lines 151–170 compose token's responsive field and 192px input. Lines 236–252 place the token reset. Line 267 uses SettingsEditRow. Lines 282–291 place Restore default address. Lines 297–316 order Discard before Save.
- `media-settings-panel.tsx:82`: independent `max-w-xl` (576px) Tool paths section. Line 85 sets 14px group title; line 88 sets `icon-xs` help. Lines 114–143 place reset/recover in outside header. Line 147 defines separate half-opacity bordered field surface. Line 160 uses fixed 72px label column and 14px vertical padding. Lines 236–266 order Save before Discard.

## Evidence boundaries and cleanup

- Browser screenshots and measured geometry directly support the default-state comparisons above.
- Source supports conditional action ordering and layout implementation; it does not substitute for interaction testing.
- Only the existing desktop preview size was inspected; responsive behavior, zoom, keyboard focus traversal, delayed reads/writes and failure states remain untested.
- No per-rule browser results exist because injection was unavailable. No live-server cleanup was necessary because none was started.
- Temporary browser tab was closed. No screenshot files or temporary scripts were written. Retained evidence files are this assessment and `detector.json`.
- No production changes or commits were made. Questions and synthesis belong to the parent critique, not this isolated evidence report.

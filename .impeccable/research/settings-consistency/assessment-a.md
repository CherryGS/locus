# Assessment A — Settings consistency

Independent design review by `/root/settings_design_review`, 2026-10-03. Operate mode. Target: `apps/desktop/src/renderer/features/settings/ui/settings-panel.tsx` and Library, External connection, Media tools children. No detector output or other assessments were consulted.

## Design specificity verdict

The content is specific to Locus: library location, current versus saved listener address, shared token, and active media executables are real local application concerns. The presentation remains largely category-interchangeable. Dark neutrals, rounded bordered containers, standard small buttons, and muted descriptions establish familiarity, but no coherent authored settings composition has yet emerged. Media tools is particularly disconnected from the two neighboring views. Its sparse form is not inherently wrong; the independently chosen measure, heading hierarchy, card boundary, and action placement make it feel like a separate implementation.

The existing shadcn treatment is evidence, not approved identity. The next pass should establish a shared settings grammar on real components and preserve their actual operations; another whole-page mock would obscure the problem.

## Evidence and limits

Inspected the actual renderer in a fresh hidden IAB tab at `http://127.0.0.1:53185/#/entity`. Opened Settings and all three categories. Opened Media tool paths help and dismissed it with Escape. No settings, tokens, or credentials were changed or revealed. The tab was closed after review. Read the named source files, settings row primitives, PRODUCT.md, rules/ui.md, Impeccable critique and Operate guidance. No ignore file was present.

At the 1280 × 720 viewport, Library and External connection use 736px-wide groups, aligned at x=384. Their group headings are 16px. Media's containing region is also 736px, but its actual tool form is capped at 576px by `max-w-xl`; its group heading is 14px and sits outside the bordered body. Media input widths are 458px; External's saved-address input is 214px. Different data lengths can justify different input measures, but the current differences are not expressed through a consistent settings layout.

Screenshots: `A-library.png`, `A-external.png`, `A-media.png` in this directory. Failure, uncertain, dirty, and pending states were reviewed in source rather than triggered live. Scores covering those states are provisional implementation-informed judgments, not empirical verification.

## Heuristic scores

All ten heuristics apply to this Operate surface. Higher is better.

| # | Heuristic | Score / 4 | Evidence |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Current runtime facts are visible; code distinguishes unsaved, saved/restart-required, uncertain and failed states. Live mutations were not exercised. |
| 2 | Match with real world | 3 | Library and connection labels are natural; executable names need domain knowledge, supplied through relevant help. Saved/active path distinction could be clearer. |
| 3 | User control and freedom | 3 | Visible close, category switching, discard actions and cancellable media reset. Media help dismissed with Escape. |
| 4 | Consistency and standards | 2 | Shared shell is sound; body width, group heading, containment, utility placement and footer order diverge. |
| 5 | Error prevention | 3 | Empty values block saving; media reset names defaults and requires confirmation; token is masked. Full behavior not tested. |
| 6 | Recognition rather than recall | 3 | Categories and runtime values stay visible; icon actions have accessible names; path form needs clearer saved-value context. |
| 7 | Flexibility and efficiency | 2 | Direct fields, copy, reload/recover and defaults are available. No task accelerators were observed; this does not justify inventing unnecessary shortcuts. |
| 8 | Aesthetic and minimalist design | 2 | Media is cleaner, but inconsistent measure/surfaces and redundant External copy weaken coherence. |
| 9 | Error recognition and recovery | 3 | Source provides local errors, retained observations, retry/recover and discard; some diagnostics remain technical. Live failures untested. |
| 10 | Help and documentation | 3 | Library and Media provide named, focusable click-open help. External relies heavily on permanent text and hover titles. |
| **Total** | | **27 / 40** | **Acceptable: significant improvements needed.** |

## Strengths

1. The stable dark settings shell, three named categories, selected-row treatment, aligned page titles and consistently placed Restart application action provide a usable common frame. There is no need to redesign navigation to fix the form.
2. The Media form exposes both editable tool configuration and actual “In use” values. These are distinct facts and should remain visible, even when they happen to match.
3. Library switching and Media tool help already demonstrate the desired information policy: concise controls with named, accessible on-demand background help. Media help is short, task-relevant, and keyboard dismissible.

## Priority issues

### [P2] Media tools breaks the shared settings composition

**Evidence:** Library and External connection use SettingsGroup (`library-settings-panel.tsx:41`, `external-access-panel.tsx:77`). Media builds a separate capped section (`media-settings-panel.tsx:82`), places its smaller heading outside the border (`:85`), and borders only the fields. The result ends at x=960 while the page's Restart application button remains at x=1120. The other groups end on that shared right edge.

**Impact:** Moving between adjacent categories changes the visual grammar for equivalent settings groups. Media looks like a narrow unfinished widget floating in a larger settings canvas. The whitespace is not the fault; the incompatible right edge and containment hierarchy are.

**Direction:** Choose one settings group measure, heading level, title-to-body relationship, surface contrast and border treatment, then apply it across these three real components. A narrow form can work if the other pages and page-header alignment obey the same rule. Do not simply add more nested cards or decorative icons. Suggested command: Impeccable layout.

### [P2] Equivalent configuration actions use different spatial rules

**Evidence:** Media Reset and Reload sit above the group, with Save then Discard at bottom-right when editing (`media-settings-panel.tsx:114`, `:232`). External restore-default sits bottom-left, reload belongs to the current address row, and its edit footer places Discard before Save (`external-access-panel.tsx:281`, `:298`). Distinct read/recover scopes are real and must be preserved, but the form-level reset and save/discard composition is not consistent.

**Impact:** Users cannot transfer their learned action scan between the two editable groups. Media's global restart sits on a different right edge from its local utility actions; the resulting two right-hand action columns strengthen the disjoint appearance.

**Direction:** Establish common placement and order for form-level defaults, save and discard. Keep row-specific runtime/token recovery adjacent to its subject. Use explicit labels such as “Restore defaults” rather than generic “Reset” when space permits. Preserve the differing reset contracts; visual consistency must not imply identical consequences. Suggested command: Impeccable shape/layout.

### [P2] External connection retains a permanent explanation layer that Media and Library have removed

**Evidence:** The page subtitle instructs using the address and token in the extension (`settings-panel.tsx:51`), Current Token repeats “Shared with your connected clients” (`external-access-panel.tsx:158`), and Saved address carries loopback/apply instructions (`:274`). Library and Media put background rules into group help. External also uses icon tiles and several description rows, increasing its visual density relative to Media.

**Impact:** Adjacent pages alternate between quiet task controls and a tutorial-like form. Readers must process small muted prose to find the facts, contrary to the user's current explanation policy.

**Direction:** Delete obvious instructions and group occasional connection/loopback rules in one named click-open help control. Convert “Active in this run” to a concise factual label if useful. Keep unsaved/restart-required facts, errors and the consequence “Reset invalidates the old Token…” visible at the reset decision; that consequence is not redundant help. Do not add a help icon to every field. Suggested command: Impeccable distill/clarify.

### [P2] Media's value hierarchy under-explains the saved/current relationship

**Evidence:** Each tool row shows the tool name, a broad ordinary-sans input, then a smaller “In use” value in monospace (`media-settings-panel.tsx:150`, `:180`). In the inspected default state the two values repeat ffprobe or ffmpeg. External explicitly labels its editable field “Saved address”; Media only explains saved configuration in its optional help.

**Impact:** A first-time user sees repeated values without a clear visible name for the editable value's role. The 458px input and tiny runtime line emphasize the editable box far more than the distinction that matters after changes. This is a modest interpretation burden, not justification to remove runtime facts.

**Direction:** Give the group a concise saved-configuration label or establish a reusable saved/active row pattern shared with External. Use consistent path/value typography across library paths, executable paths and listener addresses. Preserve live “In use,” last-confirmed and override states as ordinary visible facts. Suggested command: Impeccable clarify/typeset.

## Cognitive load

Overall moderate: two checklist failures, visual hierarchy and progressive disclosure consistency. Media itself has low option count; the problem is cross-view learning, not too many tool fields.

| Checklist | Result |
|---|---|
| Single focus | Pass: each category has a clear domain; Restart remains a secondary global action. |
| Chunking | Pass: three categories, two tools, and three External subgroups. |
| Grouping | Pass: rows group their values and actions, though the group treatment differs across pages. |
| Visual hierarchy | Fail: group headings, borders and measures change between categories; current versus editable tool values are weakly named. |
| One thing at a time | Pass: no wizard or imposed sequence; two tool edits form one meaningful saved group. |
| Minimal choices | Pass at individual decision points. Three nav categories, three token utility actions plus reset, three Media utility/help actions. |
| Working memory | Pass: actual paths/address/token remain in context; current runtime facts are not hidden in help. |
| Progressive disclosure | Fail across the set: Library/Media use optional help while External repeats background explanations persistently. |

No single local choice cluster exceeds four simultaneous alternatives. External has seven local action controls across the full page (copy address, reload address, reveal token, copy token, read token, reset token, restore address), but they belong to separate subjects. Do not call this a wall of seven options or collapse them into one menu mechanically.

Intrinsic load is real: saving configuration and applying it on restart are separate operations, and environment overrides can defeat saved values. Extraneous load comes from inconsistent page grammar and explanatory copy. Germane learning should come from one shared saved/current/action layout plus scoped help.

## Emotional journey

The shared shell initially feels calm and legible. Library conveys a single concrete fact and action. External becomes busier but provides useful operational status. Switching to Media produces the valley: a markedly narrower, differently headed form appears in the same frame, reinforcing an impression of unfinished work. The visible In use values and accurate restart-required states can provide reassurance; do not trade them for a tidier but misleading screen. No success-end state was triggered.

## Persona red flags

- **Alex, power user:** Must relearn the reset location and save/discard scan on adjacent pages. Permanent extension/token explanations slow scanning without supplying new current facts. No evidence of blocked keyboard operation or slow animation was found.
- **Jordan, first-timer:** ffprobe/ffmpeg are technical names, but their help is relevant. The ambiguous editable-versus-In use relationship remains a small interpretive hurdle. “Reset” supplies less scope than External's “Restore default address.”
- **Sam, accessibility-dependent user:** Help controls have names and Media help accepts Escape. Small 12px current-value/status text warrants zoom and contrast checks in the implementation pass; no measured contrast failure is claimed. External's restore tooltip is hover/title guidance rather than the click-open pattern used elsewhere. Critical effects must remain visible and keyboard-readable.

## Minor observations

- Large remaining space is appropriate for a two-field settings screen. Filling it with panels, summaries or prose would increase burden.
- Media's 14px group heading versus the siblings' 16px matters more than inventing a display font. Operate mode can use one carefully tuned family.
- No established product identity justifies keeping the current rounded card treatment by default, but replacing it should be a shared incremental choice, not a Media-only style experiment.

## Next design principles

1. One settings grammar: shared content measure, group heading, surface, row rhythm and footer order.
2. Value roles before decoration: make saved, active, stale and overridden facts distinguishable through concise labels and consistent typography.
3. Delete obvious explanations; put occasional background rules in one accessible help trigger per meaningful group. Keep operational consequences and present-state facts visible.
4. Preserve every operation and subject scope. Iterate the real Media group together with its neighboring Library/External group treatment, then compare the same viewport.

Questions for synthesis: Which single group treatment should these three pages teach? Can the form clearly express saved versus active values without explaining every control? Questions skipped for the user: parent handles the combined critique and next action.

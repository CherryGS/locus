---
target: Settings consistency across Library, External connection and Media tools
total_score: 27
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 0
target_identity: "file:E:\\Project\\locus\\apps\\desktop\\src\\renderer\\features\\settings\\ui\\settings-panel.tsx"
target_fingerprint: "sha256:3d4ef52efc8416ff60a7846048e240d47ad43f3a4e54604c3a9bcb02200784f7"
target_path: "E:\\Project\\locus\\apps\\desktop\\src\\renderer\\features\\settings\\ui\\settings-panel.tsx"
timestamp: 2026-10-02T21-46-46Z
slug: r-features-settings-ui-settings-panel-tsx-2f823b18
---
Method: dual-agent (A: /root/settings_design_review · B: /root/settings_evidence_review)

# Locus settings: consistency and reference review

Target: apps/desktop/src/renderer/features/settings/ui/settings-panel.tsx, including Library, External connection and Media tools.
Mode: Operate. Date: 2026-10-03.

## Design specificity

Locus exposes real, product-specific configuration and runtime facts, but its visual treatment is a collection of local compositions. Media's new styling was independently tuned while adjacent views retained different group widths, heading locations, surfaces and action rules. This is the cause of the user's valid cross-page consistency complaint. Dark colours alone do not establish a shared design language.

Impeccable's Operate guidance calls for consistent affordances and the same visual vocabulary across screens. Existing shadcn defaults remain unapproved visual authority. The next unit of work should be a shared settings composition demonstrated in all three existing categories, not another Media-only container experiment.

## Design health

All ten heuristics apply. These are design judgments, not automated accessibility scores. Normal states were inspected live; failure and asynchronous states were reviewed in source in this assessment.

| # | Heuristic | Score / 4 | Main observation |
|---|---|---:|---|
| 1 | System status | 3 | Saved, active and restart-required facts remain distinct. |
| 2 | Real-world match | 3 | Labels are mostly direct; editable versus active paths need clearer roles. |
| 3 | Control and freedom | 3 | Close, category navigation, discard and cancellable reset are retained. |
| 4 | Consistency | 2 | Widths, group headings, boundaries and utility positions diverge. |
| 5 | Error prevention | 3 | Empty inputs are guarded; reset is confirmed; Token remains masked. |
| 6 | Recognition | 3 | Current facts stay visible; saved/current path roles require interpretation. |
| 7 | Efficiency | 2 | Relevant controls exist, but users relearn their placement across categories. |
| 8 | Aesthetic/minimalist design | 2 | Different compositions and uneven explanatory copy weaken coherence. |
| 9 | Error recovery | 3 | Source retains recovery and attributed outcomes; not retested by this review. |
| 10 | Help | 3 | Library/Media have accessible help; External still relies on persistent hints. |
| **Total** | | **27/40** | **Significant consistency improvements needed.** |

## What works

- The common dark shell, category navigation, top title and Restart application position already form a useful foundation.
- Actual runtime values are exposed separately from edited configuration; this must survive restyling.
- Click-open background help in Library and Media follows the user's explanatory-copy rule.

## Priority issues

1. **P2 — Different group composition.** At 1280 × 720, Library and External groups are 736px wide with 16px titles inside their card. Media is 576px with a 14px title outside its field surface. It ends 160px before the common right edge. Establish one content measure and title/body relationship across all three categories. Command mapping: layout.
2. **P2 — Different action grammar.** Defaults appear at the bottom in External and at the top in Media; conditional save/discard order differs. Define common form-level action placement and order while preserving subject-specific copy/recovery and different reset consequences. Command mapping: layout/shape.
3. **P2 — Different explanation policy.** External retains permanent helper prose and icon tiles while the other categories were simplified. Delete obvious explanations and move occasional rules into group help; keep current states and token invalidation consequences visible at the relevant decision. Command mapping: distill/clarify.
4. **P2 — Weak value-role hierarchy.** Media's editable value and smaller In use value repeat familiar strings without clearly naming the first role. Define a shared saved/current value pattern and consistent path/address typography. Do not hide current values simply because they match. Command mapping: clarify/typeset.

## Cognitive load and personas

The difficulty is cross-view learning, not the count of two media fields. Hierarchy and progressive-disclosure consistency fail; individual choice clusters remain at four or fewer, so there is no evidence to collapse every operation into a menu.

- Power users must relearn utility positions and scan redundant External copy.
- First-time users need saved versus currently active values to be apparent.
- Keyboard/zoom users benefit from named help and stable controls; the 24px versus 28px help targets and 12px status text should be checked during implementation, without inventing a measured contrast failure.

Large unused space is not by itself a defect. Filling it with cards or prose would add burden. The visual issue is incompatible alignment, grouping and hierarchy.

## Deterministic evidence

The isolated detector actually ran over the five scoped settings UI files. It returned exit 0 with complete JSON []: zero reported findings, no rule names or locations, no false positives. The scan does not measure cross-page design coherence, so it neither refutes the visual findings nor proves quality.

Browser evidence independently measured the same group/title differences and confirmed that inputs/buttons already share the same underlying primitives. The next fix belongs mainly to composition and shared settings patterns, not replacing the input library.

## Official application references

These are real screenshots inspected in the browser, not generated proposals or approved Locus directions.

### Raycast — primary reference recommendation

[Current settings manual](https://manual.raycast.com/settings)

![Raycast Advanced settings](https://fz1sd71lwhbqy6sh.public.blob.vercel-storage.com/raycast/images/app/basics/mac-basics-settings-advanced.png)

Observed: restrained group surfaces, consistent left labels/right controls, fine internal dividers, and repeated control alignment throughout the same settings shell. Borrow the common row/group composition and control weight. Its persistent descriptions and background blur are not user requirements and should not be imported automatically.

### Eagle — desktop density and grouping reference

[2026-03-03 Preferences redesign](https://eagle.cool/blog/post/eagle4-build20)

![Eagle Preferences](https://r2-web.eagle.cool/blog/post/eagle4-build20/cn/0e4fbcd6-9800-48a1-b187-17f0f37eb13f.webp)

Observed: explicit but quiet section grouping, common card width/insets, restrained sidebar selection and dense rows. It demonstrates that cards can work when the whole settings surface follows one grammar. Its separate-window lifecycle and large bottom Save/Apply strip are not Locus requirements; preserve the existing host and per-group save contracts.

### Linear — typography and continuous row reference

[Current preferences documentation](https://linear.app/docs/account-preferences)

![Linear Preferences](https://webassets.linear.app/images/ornj730p/production/4f79d61790a704d7e47e00611e8615a30f932979-2084x1633.png?w=1440&q=95&auto=format&dpr=2)

Observed: section headings use consistent offsets, rows share the same inset and control edge, and theme/state accents occupy a small part of the surface. Borrow the disciplined rhythm, not its many explanatory subtitles. The earlier 2022 design article was consulted but this board uses the screenshot in the current documentation.

## Proposed next step

Use one primary reference, provisionally Raycast's shared settings grammar, with Locus's confirmed dark mode and on-demand help policy. Apply one shared section heading, content width, row grid, surface and action order to Library, External and Media. Inputs, read-only paths and token controls can vary by role within that grammar; their business actions, saving/restart semantics and information remain unchanged.

Deliver the three real settings categories at one viewport for comparison. This is still component-led work: one shared settings component family across its consumers, rather than separate page designs. No new production UI changes were made during this research.

## Question for the next iteration

Which primary reference feels closest: Raycast's restrained grouped rows (recommended), Eagle's stronger desktop grouping, or Linear's tighter continuous rows? Existing dark-mode, behavior-preservation and incremental-work decisions are settled and are not reopened.

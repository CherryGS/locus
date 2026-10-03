# UI rules

## Information visibility

- Show ordinary inspector fields directly. Identifiers, copy actions, dates,
  status, storage facts and short property groups do not need a disclosure click.
- Use collapse only for an actual hierarchy or unusually long optional content
  where hiding it materially improves the task. Do not make every section an
  accordion simply to shorten the panel; use headings, spacing and scrolling.
- Keep values readable while giving feedback. For example, copying an ID should
  change its icon/status, not replace the ID with a shorter success message.

## Boundaries and control geometry

- Page header dividers belong to the page container, outside padded or
  width-constrained header content. Draw one 1px divider across that container
  with the shared Separator and border token. A child summary strip must not
  add another competing page boundary.
- Render separator strokes with native 1px borders, rather than a 1px filled
  background rectangle. Check grid and inspection headers at fractional
  browser zoom as well as 100%; equal CSS heights alone do not verify stroke
  consistency after rasterization.
- Property-group dividers follow the full width of their owning panel or
  reading column. Use the same width and alignment for sibling groups. A
  reading column may be narrower than the page; that is a different layer,
  not a reason for sibling dividers to vary. Avoid local margin/width overrides
  on separators. Frame boundaries and group boundaries remain distinct.
- Pure icon buttons use square shared Button size variants. Do not combine
  a text-button size with min-width or horizontal padding to approximate an
  icon target. Use the icon size supplied by that variant.
- Dense footer actions use FooterAction: 24px height, a 24px square when
  icon-only, and a 12px icon. A visible count may extend the button width.
  Tasks and notifications share this implementation; their labels remain
  available through accessible names and titles.
- When changing a shared visual rule, migrate the affected consumers and check
  computed geometry in the real renderer. Update this rule at the same time
  instead of adding another page-specific workaround.

## Explanatory copy

- Default to showing content and actions. Delete explanations already conveyed by
  control labels, familiar interaction conventions or the surrounding design.
  Do not repeat them as permanent small text beside each item.
- Put useful but occasional background rules in on-demand help near the relevant
  action or group. Use a tooltip for a short clarification and a clickable help
  popover for longer explanations. Trim redundant copy before moving it there.
- Help must have a discoverable, accessible trigger and work with keyboard focus
  and activation. Do not make necessary information available only on hover.
- Keep current errors, unsaved changes, pending application and other facts needed
  to judge the present operation visible and concise. Show consequential action
  effects at the decision point; do not bury them in optional help.
- Apply this rule to explanations, not ordinary content or inspector facts. Avoid
  replacing inline clutter with a help icon on every field; group related help
  at the smallest useful scope.

## Stable updates

- Distinguish an initial load from refreshing already observed data. Keep existing
  content mounted during a refresh. Do not replace a populated panel with a
  skeleton, empty state, loading paragraph or entrance animation after each edit.
- Invalidate the smallest affected data scope. Changing a tag must not reload
  unrelated Entity metadata, media resources or the vocabulary it did not change.
- Keep keys tied to stable subject identities. Loading flags, request IDs and
  revisions must not remount an editor, dialog, list or preview during an update.
- Preserve focus, caret/selection, expanded branches and scroll position. Pending
  or success feedback must not change a dialog's bounds or shift nearby actions.
- Keep pending feedback local to the affected operation and within its existing
  footprint. Do not dim or disable an entire form when only one item is pending;
  prevent duplicate operations on that item until its observation has caught up.
- Fast saves should produce the resulting state without a sequence of transient
  loading messages. Avoid duplicate banners for pending/success when the control
  already communicates the change. Errors and uncertain outcomes remain visible
  and actionable; retained values must not impersonate a successful fresh read.
- Reconcile asynchronous results with both their original subject and the latest
  update. Late results must not overwrite newer edits or a newly selected subject.

## Verification

- Inspect the actual renderer through the existing isolated preview workflow.
  Check both fast responses and deliberately delayed reads/writes when changing
  asynchronous interaction. Verify stable bounds, focus, scroll and unrelated
  controls across the whole update, not just the final screenshot.
- Exercise failure/retry and navigation during a pending update when relevant.
  Keep verification proportionate and target observed regressions.

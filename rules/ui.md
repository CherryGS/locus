# UI rules

## Information visibility

- Show ordinary inspector fields directly. Identifiers, copy actions, dates,
  status, storage facts and short property groups do not need a disclosure click.
- Use collapse only for an actual hierarchy or unusually long optional content
  where hiding it materially improves the task. Do not make every section an
  accordion simply to shorten the panel; use headings, spacing and scrolling.
- Keep values readable while giving feedback. For example, copying an ID should
  change its icon/status, not replace the ID with a shorter success message.

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

# Filter workspace refinement

The established quiet dark system carries through to Filter: presets support the
raw query, the control surface separates source from surrounding chrome, field
groups remain plain reference content, and the footer owns Apply/Save actions.
No query grammar, coordinator behavior or completion contract changes.

Read-only field references follow the user's native-selection decision. Row copy
buttons, clipboard handlers, copy feedback and their tab stops are removed. Field
names and types remain visible and selectable, including exact references.

The isolated real renderer at 842×958 and 720×480 was inspected with empty,
multiline, long and invalid source. Long source scrolls inside the textarea;
editor/reference scrolling remains separate. Clicking a diagnostic returned focus
and selection to its source position. Short-window header/footer spacing reserves
enough reference space even with existing status feedback.

Computed contrast ratios: source 14.88:1, placeholder 8.86:1, reference type 7.87:1.
Source measured 13px/24px monospace, field names 12px/24px regular monospace, and
reference rows inherited `user-select: text`. No horizontal dialog overflow was
observed. Local screenshots are under `.local/visual-foundation-v01/filter-*.jpg`.

The existing Filter browser verification now checks actual native drag selection
and type alignment instead of removed copy controls. Its format-choice scenario
waits for the new value context before editing the lookup; previously it could
write into the previous context before the source owner's reply reset it.

Type checks, desktop build, structural validation and the final layout detector
passed. The complete real Filter browser suite passed with evidence retained in
`target/desktop-entity-filter-1790991231450`. Manual draft checks did not save a
preset or replace the retained preview's result.

# Media tools component iteration

The initial large settings Card had permanent explanatory copy, generous repeated
row framing and a separate reset footer. The user explicitly rejected the first
frameless revision as visually worse. Removing a container is not itself a design
improvement: this component needs clear grouping and controlled proportions.

The current revision uses a compact shared surface for both fields, with one
divider, restrained bounds and a maximum width of 36rem. Help follows the group
heading; Reset and reload sit in its toolbar. Save/discard appear when applicable,
without a permanent footer. Tool definitions and path-entry guidance live in a
keyboard-accessible help popover. Input, current runtime value, environment source,
errors, restart state and unresolved outcomes remain distinct and visible.

## Evidence

- `before.jpg`: original large Card.
- `after.jpg`: rejected frameless iteration, retained only for comparison.
- `help.jpg`: help behavior during that earlier iteration, not current layout.
- `revised.jpg`: current real-renderer normal state.
- Typecheck and renderer build pass. Thirteen existing settings/navigation tests
  passed during this change; the coordinator and lifecycle logic are unchanged.
- A separate temporary library exercised validation, Save, restart-required
  observation, a newer draft alongside the saved value, discard and confirmed reset.
- The revised toolbar opens the same reset confirmation; Cancel restores Settings.
  Invalid drafts disable Save and remain described by the error element. The
  current runtime value keeps its normal text colour while draft validation is red.

This is a component iteration, not an approved global visual language. Work on
related components only when their context and required information are inspected.

# Current library: first component iteration

The user selected component-by-component changes after generated page samples
drifted from actual UI logic. This example addresses the specifically reported
large card footer/button treatment, using the real Settings component.

## Change

`apps/desktop/src/renderer/features/settings/ui/library-settings-panel.tsx`
places its existing action at the end of the card content instead of the separate
footer band. The button uses the existing small outline variant. Path, source,
copy, DOM reading order, handler, disabled state and outcome feedback are retained.
No shared Card/Button defaults or neighboring components are restyled.

## Evidence

- `before.jpg`: actual renderer before the change.
- `after-narrow.jpg`: actual renderer after the change in a narrower app panel;
  this is not a same-size pixel comparison. Path wraps and content stays readable.
- `error.jpg`: Enter on the action retains keyboard focus and exposes the isolated
  preview adapter's existing native-library-switch limitation.
- Typecheck and renderer production build pass. Build reports its existing
  large-chunk advisory; no production native restart was exercised for this
  presentation-only change.
- The updated card contains no CardFooter and no horizontal overflow at the
  observed narrow size. All original text and exactly one action are present.

These are browser screenshots of an isolated real renderer, not generated design
images. This is a bounded first iteration, not approval of a global visual system.

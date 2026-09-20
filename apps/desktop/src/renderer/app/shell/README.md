# Desktop shell

The root route keeps the title bar, left navigation and footer mounted while
page outlets change. The remaining main region is an unpadded, full-height page
outlet. Each page owns its header, scrolling, content and auxiliary tools.

Left navigation remains a collapsed icon rail. A 300 ms hover reveals labels
over the main area without moving its edge. Leaving for 150 ms hides the reveal;
returning cancels closure. The same mounted links survive route changes, and
icons keep their position through the width transition. Keyboard focus can also
reveal labels, while pointer-click focus does not prevent closing after leave.
These states last for the mounted shell; no persistent preference is introduced.

The Entity page owns its grid, inspector and component-button rail inside its
own workspace below its page header. Home and Setting use the same outer frame
without inheriting Entity's selection or inspector.

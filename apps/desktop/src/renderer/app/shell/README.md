# Desktop shell

The root route keeps this shell mounted while page outlets change. Auxiliary
panel state is a selected panel identity or null. Only Overview currently has
a real consumer; later panels can include selected-component details or other
auxiliary tools without introducing a registry now.

Left navigation remains a collapsed icon rail. A 300 ms hover reveals labels
over the main area without moving its edge. Leaving for 150 ms hides the reveal;
returning cancels closure. The same mounted links survive route changes, and
icons keep their position through the width transition. Keyboard focus can also
reveal labels, while pointer-click focus does not prevent closing after leave.
These states last for the mounted shell; no persistent preference is introduced.

The main content and open auxiliary panel share a horizontal resizable group.
The divider supports dragging and keyboard resizing. Panel width starts at
256 px and survives closing, reopening and route changes in the mounted shell.
The auxiliary panel retains its pixel width when the window changes size, with
minimum widths of 12 rem for details and 16 rem for the main content so that
both remain usable. The fixed panel-button rail is outside the resizable group.

The Entity page will later gain a virtual grid when entity content is introduced.

# Desktop shell

The root route keeps this shell mounted while page outlets change. Auxiliary
panel state is a selected panel identity or null. Overview is always available;
File and Image appear only when those components exist on the selected entity.
If the current component disappears on selection change, the open panel returns
to Overview. Clicking the active panel closes it, while another button switches
content. Selecting an entity updates content without opening a closed panel.
Other auxiliary tools can join this shell without a generic registry now.

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

The app provides workspace selection through `features/entity-selection`; both
the Entity page and this shell consume it. Selection and panel width survive
route navigation for the mounted workspace.

# Desktop shell

The root route keeps this shell mounted while page outlets change. Auxiliary
panel state is a selected panel identity or null. Only Overview currently has
a real consumer; later panels can include selected-component details or other
auxiliary tools without introducing a registry now.

The title-bar navigation control switches between a pinned expanded layout and
a collapsed icon rail. In the collapsed layout, a 300 ms hover reveals labels
over the main area without moving its edge. Leaving for 150 ms hides the reveal;
returning cancels closure. The same mounted links survive route changes, and
icons keep their position through the width transition. Keyboard focus can also
reveal labels, while pointer-click focus does not prevent closing after leave.
These states last for the mounted shell; no persistent preference is introduced.

The Entity page will later gain a virtual grid when entity content is introduced.

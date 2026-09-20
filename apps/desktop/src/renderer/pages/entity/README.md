# Entity browser

The page receives renderer projections as data and uses the workspace's single
selection. `entities/entity` owns card/detail presentation; the selection feature
owns transient selection; the app wires the data source and auxiliary panels.
These view values are not another HTTP or domain-write contract.

Cards have a 4:3 preview area that contains the original aspect ratio and a fixed
caption area. Available width determines the number of columns. TanStack Virtual
mounts visible rows with two overscan rows in each direction. The selected row
also stays mounted to keep the grid's active descendant valid during scrolling.
Selection follows entity identity, not the current row or column.

The grid is one keyboard stop. Arrow keys move single selection; Home/End move to
the row edges, and Ctrl/Cmd + Home/End move to the list edges. Keyboard movement
scrolls the target into view. Resizing keeps a visible selection in view; when
browsing elsewhere, it retains the first visible entity. Row-size estimates must
be invalidated on width changes even when the column count remains unchanged.

The app route supplies offline development specimens with image, file-only and
component-free items. Production builds omit these fixtures and use the empty
state until a real library read is connected. There are no import controls,
filesystem paths, persistence or mutation operations in this step.

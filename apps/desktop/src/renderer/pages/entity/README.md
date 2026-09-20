# Entity browser

The page receives renderer projections as data and provides its own single
selection. `entities/entity` owns card/detail presentation; the selection feature
owns transient selection; the app supplies the data source. These view values
are not another HTTP or domain-write contract.

The page header spans the available width and owns the title and future page
actions. Below it, EntityWorkspace contains the grid, resizable inspector and
component-button rail. The grid and inspector fill that workspace's height;
their scroll tracks begin and end at the same boundaries. Shadcn ScrollArea
provides the thin scrollbars. Grid content has internal spacing, so cards do not
touch the scroll track.

Cards are fixed at 280 by 274 pixels, with a 4:3 preview area containing the
original image ratio and a 64-pixel caption. Both grid gaps remain 16 pixels.
Available width changes the column count and centers the complete column group
without stretching cards. `entity-grid-layout.ts` owns these dimensions and the
32-pixel horizontal / 24-pixel vertical insets. The grid's minimum pane width
is derived from one card and its horizontal insets.

TanStack Virtual mounts visible rows with two overscan rows in each direction.
The selected row also stays mounted to keep the grid's active descendant valid
during scrolling. Selection follows entity identity, not the current row or column.

The grid is one keyboard stop. Arrow keys move single selection; Home/End move to
the row edges, and Ctrl/Cmd + Home/End move to the list edges. Keyboard movement
scrolls the target into view. Resizing keeps a visible selection in view; when
browsing elsewhere, it retains the first visible entity. Card height is constant;
only column changes regroup rows.

Overview is always available. File and Image appear only for components present
on the selected entity. If the active component disappears, the open inspector
returns to Overview. Clicking the active panel closes it; another button switches
content. Selection updates content without opening a closed inspector. Inspector
width starts at 256 pixels and is retained when closed/reopened within this page.
Selection and inspector state belong to the mounted Entity page; navigating to
another page unmounts this workspace.

The app route supplies offline development specimens with image, file-only and
component-free items. Production builds omit these fixtures and use the empty
state until a real library read is connected. There are no import controls,
filesystem paths, persistence or mutation operations in this step.

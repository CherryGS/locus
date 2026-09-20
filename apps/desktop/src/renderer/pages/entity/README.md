# Entity browser

The page receives renderer projections as data and provides its own single
selection. `entities/entity` owns card/detail presentation; the selection feature
owns transient selection; the app supplies the data source. These view values
are not another HTTP or domain-write contract.

The page header spans the available width and owns the title and future page
actions. Below it, EntityWorkspace contains the grid, resizable inspector and
component-button rail. The grid and inspector fill that workspace's height;
the grid's scroll track spans the workspace boundaries. Shadcn ScrollArea
provides the thin scrollbars. The grid scroll track has a visible left border;
the inspector's resize divider (or the closed inspector's rail divider) forms
its right boundary, with equal padding on both sides of the thumb. Grid content
has internal spacing, so cards do not touch the scroll track.

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

Card presentation uses static per-slot candidates in
`entities/entity/model/entity-card-display.ts`. Component display items live in
`component-display-items.ts`; `display-slot.ts` picks the first defined value.
The initial card mapping uses File's original name, Image's preview, and Image
dimensions before File size for the summary. Missing contributions leave the
card's existing label/icon/Entity-text fallback in charge. These mappings are UI
choices, not domain fields or persisted preferences. Supplied retained metadata
remains eligible; there is no input-age check, fetch scheduler or remembered winner.
Thumbnail resources sit with the Image projection. Overview reads its data
directly and does not consume card slots. Grid cell names refer to the rendered
card title while selection and virtual row identity still use Entity IDs.

Overview is always available. File and Image appear only for components present
on the selected entity. If the active component disappears, the open inspector
returns to Overview. Clicking the active panel closes it; another button switches
content. Selection updates content without opening a closed inspector. Inspector
width starts at 256 pixels and is retained when closed/reopened within this page.
Selection and inspector state belong to the mounted Entity page; navigating to
another page unmounts this workspace.

The inspector keeps its title visible while details scroll; switching panels
starts the newly selected panel at the top. Overview presents
the preview, full name and component badges. The entity or component identity
follows its panel title. The ID button truncates in a narrow pane but retains
the full value in its hover title and copies that full value to the clipboard.
It has no icon, and the hover title contains only the ID. Successful copying
briefly shows "Copied"; failures are reported without claiming success.
The inspector uses compact Figma-inspired property sections: named
Properties/Color/Components groups, full-width section separators, a consistent
label column (80 pixels, reducing to 72 in narrow panes) and left-aligned text
values. Ordinary rows are 28 pixels high; secondary
values are smaller and rows grow naturally for wrapped content. A subtle row
hover helps track label/value pairs without turning read-only facts into inputs.
Both Overview and File present names as ordinary fields. File sizes show readable
binary units alongside exact bytes. Long filenames wrap within the pane and
remain selectable.

File metadata choices from the UI discussion: retain the original leaf filename
captured at admission and show it read-only, without a separate editable display
name. Show the extension derived from that name, not a MIME field. Show import
time in the viewer's local time zone, without source filesystem creation or
modification times. The name does not determine the managed storage path. The
current renderer uses specimens; retaining the original filename and import time
in the File backend remains later integration work.

Image shows the parsed format and pixel dimensions, plus their reduced width:height
ratio and total pixel count. The count displays megapixels alongside exact pixels;
these two derived values do not introduce independently stored metadata.
The selected color fields are color mode, bits per channel and presence of an
alpha channel. Alpha presence does not claim that any pixel is transparent.
These remain explicit UI specimens until Media retains and exposes those facts;
the current backend only supplies Image format and dimensions.

The app route supplies offline development specimens with image, file-only and
component-free items, including a long-name/UUID specimen for narrow panes.
Production builds omit these fixtures and use the empty
state until a real library read is connected. There are no import controls,
filesystem paths, persistence or mutation operations in this step.

# Entity browser

The app supplies renderer projections and identified related collections.
The route owns the one selected Entity,
grid/inspection mode, collection identity and lightweight source destination.
History stores those identities, never Entity payloads or media bytes. Card and
detail facts remain presentation projections rather than domain-write authority.

The list header uses its remaining width for Search. Submitted Search text and
the applied Filter are independent and compose as `(Search) AND (Filter)`;
unapplied Filter drafts do not participate, and presets save only Filter content.
A pending or rejected search retains the previous result. Counts, selection and
collection context register into the centered titlebar display, owned by the
active page. Overview omits a redundant Component count.
The toolbar shares the main canvas without a horizontal divider; auxiliary
panels retain their resize boundary and separate surface.

Inspection uses a centered strip over the full current sequence. Its 88-pixel height holds
96 by 72-pixel thumbnail frames with 4-pixel gaps; images preserve their complete
aspect ratio. A uniform quiet frame and full-height preview area align image and file
items; a muted border and background mark the current item. Neighbor buttons sit
beside the visible frames, and the strip mounts only the nearby items that fit.
Each frame's top-centered overlay names the Component used for its main content
view, following that Entity's current page-local choice. The selected frame also
reflects a temporary source-view override. No available view is labeled "No view";
an image load failure alone does not change the selected Component label. White
text sits on a half-transparent black background without reserving image space.
History controls and the inspection-only Return to source action belong to the
persistent titlebar. The page supplies its return action through a visual portal,
so its source navigation and temporary view state remain page-owned. Below the page header,
EntityWorkspace mounts either the grid or current content alongside the existing
resizable inspector and component rail. No inactive grid/content tree is retained.
The inspector's open state and last width remain with the mounted workspace.
Its resize separator occupies its own strip, with the visible border next to the
grid scrollbar. Pointer hit testing uses that actual box rather than an expanded
region overlapping the scrollbar; clicking the track scrolls, while dragging the
separator resizes. The strip is wider for coarse pointers.

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

Double-click or Enter opens every Entity, including File-only and empty items.
Image inspection, Video playback, Twitter reading and File information are static Component views;
no available view produces a placeholder. Previous/next and arrow keys follow the
complete supplied order and wrap. One-item selection does not append a visit or
reset the content. Missing or failed image resources remain in the chosen view.

Video plays an explicitly supplied source with native inline controls and
metadata preloading. It opens paused, preserves the whole frame within the pane,
and does not automatically advance to another Entity on completion. The active
view owns one player; leaving it pauses playback, clears the source and calls
`load()` to release that media element's resource. Reopening starts at zero.
History contains no player or playback-position cache. Native browser caching is
not an immediate memory-eviction guarantee.

While a video/control has focus, native seek and volume keys take precedence over
the page's left/right Entity navigation. The neighboring strip, titlebar history
and source-return action keep their existing behavior; Esc returns to the source.
Fullscreen, Picture-in-Picture and remote-playback UI are not offered in this
inline iteration. Missing sources and load/decode failures show a simple error
without skipping the Entity, changing its chosen view or starting transcoding.
Playback support is the embedded browser's support for the supplied file; this
does not promise playback of every format the backend can probe.

Grid selection replaces the current location. Opening inspection, entering a
related collection and moving to a different Entity append real router visits.
Titlebar Back/Forward controls and Alt+Left/Right (Cmd+[ / Cmd+]) use that history
throughout the shell. Esc also works after a titlebar control takes focus. It is a
separate source-directed visit: grid exits select/reveal the last Entity with the
current column count and return focus; related exits restore the owner and its
source content view. That source-view override is transient. Back/Forward uses
the current page-local choice and never treats a prior view choice as an undo operation.

Overview's Components section selects applicable content views. An explicit choice
switches content and updates only that Entity's temporary choice in page state.
The choices survive inspection/history navigation while this page is mounted;
leaving the page or restarting resets them. There is no preference API, async
read/save adapter, save queue, browser persistence or native backend connection.
An unavailable chosen key resolves to an available view without rewriting it.
The eventual requirement is independent database-backed defaults across restarts,
but the read/write flow has not been designed. The value may arrive with other
Entity information; this UI does not prescribe a separate fetch or storage schema.

The app supplies Sample 003's File-view gallery over existing specimen Entities.
Gallery entry and navigation use the same routed content/inspector pipeline.
The collection declares membership and source meaning; no Model records or
relationship persistence are implied. Image resources reset on Entity/view entry,
so late events cannot change the current subject's load/transform state.

Each image starts fitted to the available area without upscaling. Fit uses the
loaded representation's intrinsic dimensions, not retained metadata. The mouse
wheel zooms around the pointer, dragging pans, and +/- keys or buttons zoom around
the viewport center. Zoom feedback and controls appear briefly over the image
when zooming, staying available while hovered or keyboard-focused. The percentage
button or 0 returns to fit. Return to source stays in the titlebar during
inspection, including unavailable images and non-image views. No fixed viewer toolbar is
reserved above the image. Changing images resets zoom and pan; resizing the pane
updates fit while fit mode is active.
The viewer uses the Image projection's existing thumbnail representation and CSS
transforms; it does not yet request an original-resolution resource.

Card presentation uses static per-slot candidates in
`entities/entity/model/entity-card-display.ts`. Component display items live in
`component-display-items.ts`; `display-slot.ts` picks the first defined value.
The card mapping uses File's original name, Image's preview before Video's poster,
and Image dimensions before Video duration before File size for the summary. Missing contributions leave the
card's existing label/icon/Entity-text fallback in charge. These mappings are UI
choices, not domain fields or persisted preferences. Supplied retained metadata
remains eligible; there is no input-age check, fetch scheduler or remembered winner.
Static thumbnail resources sit with the Image or Video projection. Overview reads its data
directly and does not consume card slots. Grid cell names refer to the rendered
card title while selection and virtual row identity still use Entity IDs.

Overview is always available. File, Image, Video and Twitter appear only for components present
on the selected entity. If the active component disappears, the open inspector
returns to Overview. Clicking the active panel closes it; another button switches
content. Selection updates content without opening a closed inspector. Inspector
width starts at 256 pixels and is retained when closed/reopened within this page.
Selection belongs to the route. Inspector state belongs to the mounted Entity
page; navigating to another page unmounts this workspace.

The inspector keeps its identity header visible while details scroll; switching panels
starts the newly selected panel at the top. Overview presents available Component
view choices first, then properties including the full name, without a preview
image. The header shows only the entity or component ID; panel names remain on
the vertical rail and in accessible region labels. The ID button truncates in a narrow pane but retains
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

Video's first property set is format, pixel dimensions, duration, frame rate and
codec. Missing facts display "Unknown" instead of fabricated zero values. These
are supplied renderer facts and are independent of whether playback succeeds;
native playback events do not overwrite retained metadata. Video resource access
and real-library data flow remain separate integration work.

Twitter's selected UI fields are:

- Author display name, handle, user ID and profile link, without an avatar.
- Full post text, post ID and original-page link.
- Publication time and capture observation time as distinct values, rendered in
  the viewer's local time zone. Capture time is not File import time.
- The current media's observed source order (displayed one-based) and ALT text.
  Unknown order is not inferred from an Entity list. Media IDs are not shown.
- Reply, quote and repost relationship types with target links; no target-post
  expansion, remote fetch or inferred local-Entity relationship.

Hashtags remain literal text when present in the body. They have no separate
section and do not become user-managed tags. This iteration adds no interaction
counts, remote media previews, acquisition or snapshot mutation.

The main Twitter view presents a compact post card with author, publication time,
unabridged multiline text, the original link and reference links. The inspector
contains the full field set so it can accompany Image/Video views. It retains
the ID-only sticky header. Post and author IDs use the same full-value copy
control as local Entity/component IDs; long values truncate visually. Link
labels are short, with their complete destinations retained in hover titles.
Captured text is rendered as text, never injected HTML.

A missing observation displays "Not captured"; an observed empty text or list
has an explicit empty result. A locator-only capture still offers its Twitter
view and remains in the full navigation sequence. These views do not establish
live remote availability, File association or a text-only collection workflow.

Image and Video remain the ordinary content-view defaults when present. Twitter
is available independently, and is preferred over File information when no media
view exists; an explicit per-Entity choice takes precedence as before. Card
titles fall back from File's name to captured post text or locator, with author
as the last summary candidate. They do not replace media preview/summary slots.
No author/post object, persistent preference contract or provider API is added.

The app route supplies offline development specimens with image, video, file-only and
component-free items, including a long-name/UUID specimen for narrow panes.
Production builds omit these fixtures and use the empty state until a real
library read is connected. This UI has no persistent writes and does not create
or mutate Core/File/Media records. There are no import
controls, arbitrary filesystem paths or Model payloads.

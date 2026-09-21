# Desktop

`just desktop-run` opens the standalone Electron/Vite development shell with
synthetic UI specimens and hot updates. It does not start the Rust server, open a
library, import files or install a preload bridge.

`just desktop-ui` serves the same renderer in an independent browser-only Vite
consumer. Use an isolated in-app browser or headless browser for ordinary UI
verification without taking the desktop pointer or focus.

`just desktop-install` installs the pinned desktop lockfile and explicitly
downloads Electron. `just desktop-check` generates routes and checks separate
Node and renderer TypeScript boundaries. `just desktop-test` runs card, image
geometry, view-resolution and navigation tests. `just desktop-build` builds the
host and production renderer, omitting specimen data; `just desktop-preview`
builds and opens that production preview. Production shows an empty Entity list
until real browsing data is designed and connected.

The renderer uses FSD: app supplies entry, routes and specimens; pages/entity
owns inspection composition and navigation; entities/entity owns card/detail
presentation; shared owns Base UI shadcn components. Route files are thin adapters
and the route tree is generated.

Entity inspection follows the complete supplied list, including File-only and
no-view entries. The titlebar contains history controls and Return to source
while inspecting an Entity, and the Entity page
header contains nearby previews.
Overview places Component view choices above its properties without repeating
the preview image. It selects a content view independently of the detail panels. Back/Forward
traverse actual visits; Esc returns to the declared source. Sample 003's File
view supplies a gallery over existing specimen Entities; Sample 009 demonstrates
an unavailable image and Sample 013 has no content view.

Video uses the browser's native inline playback controls. Sample 005 is landscape,
Sample 006 is portrait, Sample 012 has an invalid video resource, and Sample 016
has a Video component without a playable source or known metadata. The first two
are eight-second, synthetic MP4 clips with a silent audio track. They load only
in the development specimen route; grids and neighboring previews use static
posters rather than mounting players.

To regenerate the checked-in media fixtures, run
`node apps/desktop/scripts/generate-video-specimens.mjs` from the repository root
with ffmpeg on PATH, or set `LOCUS_FFMPEG` to its executable. This is a development
fixture tool, not a desktop runtime dependency or a real-library import path.

Twitter is another read-only Component view. Sample 002 combines Image and
Twitter, Sample 005 combines Video and Twitter, and Sample 010 supplies a capture
without local media. Sample 011 has only a post ID; Sample 018 has observed empty
text/ALT/references. Overview chooses the content view for that Entity; the right
rail independently opens its Twitter details. Author, text, source links, dates,
media position/ALT and reference links are fictional supplied observations.
No provider requests, imports or backend writes happen while rendering.

Source links open in a new browser tab during browser preview. Electron delegates
HTTP(S) links to the system browser and denies the child Electron window; other
protocols and credential-bearing URLs are not handed to an OS protocol handler.
No preload or general native bridge is introduced for this link action.

View choices are temporary, independent values in Entity page state. They remain
available during inspection/history navigation, but leaving the page or restarting
clears them. No database, localStorage or HTTP preference adapter is involved.
Eventual persistence belongs in the database per Entity; its read/update/save flow
is deferred to design and may accompany other Entity information. This UI selects
neither a dedicated preference API nor a storage schema.

The specimens and gallery are presentation inputs, not seeded domain records or
a Model backend. There is no real-path import, library browsing or persistent
write in this UI iteration.

# Desktop

For a persistent offline verification library covering the existing File, Media,
Model, Twitter, Civitai and Bilibili behavior, use `just desktop-sample-generate`,
`just desktop-sample-verify` and `just desktop-sample-preview`. The
[sample-library guide](scripts/SAMPLE-LIBRARY.md) documents named cases, optional
retained public inputs, binary overrides and durable output outside `target`.

`just desktop-run` and `just desktop-preview` build and open the connected
Electron application. Electron owns one Rust backend process and loads the built
renderer from its authorized Axum origin. Normal launch uses the existing library
convention: explicit `LOCUS_DATA_DIR`, otherwise the first line of the
application-data `Locus/path` locator, otherwise application-data `Locus`.
These normal launch commands can open the user's library.

Settings → Library → **Choose library and restart** opens a native folder picker
for an existing library containing `metadata.sqlite`. The current session's
settings/view-choice preparation and accepted-work drain finish before the host
relaunches into the chosen directory. Canceling preparation keeps the old session
and drafts. Files are not moved or copied. After successful backend startup, the
host atomically updates the existing `Locus/path` locator; explicit launch paths
and `LOCUS_DATA_DIR` continue to take priority. A failed target startup does not
replace that locator or create a fallback library. Browser preview cannot invoke
this native operation.

`just desktop-library-switch` verifies folder cancellation, invalid/same targets,
draft confirmation, actual switching between two isolated libraries, fresh run
identity, and the persisted locator using hidden Electron windows.

Optional `LOCUS_SERVER_BINARY` and `LOCUS_RENDERER_ROOT` must be absolute paths.
Defaults are the repository's debug server and desktop renderer build. Missing
artifacts produce native feedback. No installer is supplied. `npm run dev`
rebuilds and launches the same Axum consumer, preserving production origin rules.

Live content views include Image, Video, Model, Twitter, Civitai and File information.
Attached component metadata is read for the needed range. Unsupported
kinds retain their Component and Kind identities with an explicit reader limitation.
Live records have no invented Entity name, original filename, import date or color
facts. Identity labels are display fallbacks. Exact byte counts and revisions remain
integer text.

Browsing waits for a complete compact binary identity sequence. Grid, neighboring
navigation and history use indexed identities and bounded observation caches.
The grid maps a bounded physical scroll surface to the complete logical sequence.
Refresh replaces IDs only after a successful complete read and rereads current
demand. Failed Entity rereads retain prior same-subject facts with qualification;
confirmed membership or record replacement never inherits another subject's facts.

Explicit view choices save automatically. Current intent, saved observation and
fallback display remain separate. One unsettled mutation per Entity retains its
original request/run/body/revision through recovery. Newer unsent choices coalesce;
offscreen unconfirmed choices survive page navigation. Overview offers read retry,
save retry or confirmation recovery according to the actual outcome. A fallback
or metadata read never writes preferences.

Image viewing reads the owner-observed current File bytes separately from metadata.
It never generates previews or interpretation. Access and decoding failures keep
the Entity/view and add their own attributable problem. Component/File identity and
retry generations reject stale resource completions; active object URLs are revoked
on replacement or unmount.

Normal close prepares final choices, offers return/continue for unconfirmed items,
seals new intent at the handoff, then invokes the existing accepted-work drain.
The window remains until actual completion. Returning before committed exit preserves
saving; committed drain cannot reopen admission. Native startup, renderer-unavailable
and backend-loss feedback remains available without the business page. Backend loss
revokes authorization and requires manual application restart.

The sandboxed preload exposes typed connection observation, renderer readiness and
current-close-attempt coordination. Credentials remain in Electron main, restricted
to the exact origin/window/main frame. Explicit run headers are preserved; redirects
and foreign contexts never acquire the grant.

## Isolated verification

`LOCUS_PREVIEW_PROFILE=civitai` selects the connected Civitai A/B/C fixture for
`just desktop-ui`; `just desktop-civitai-browser` runs its headless checks.
Automatic Model matching in browser fixtures uses the isolated `fixture-server`
upstream adapter (default: definite no-match), so existing tests do not contact
the live provider. Domain/store/File/Media/HTTP/client/renderer remain real.
The Civitai profile supplies controlled metadata/images and prints its entry IDs.

Every verification command below creates a synthetic temporary library and never
opens the default user library. Native checks use hidden windows and a test-only
entry that intercepts native dialogs before importing the actual production host.

| Command                             | Coverage                                                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `just desktop-check`                | Main, actual preload, renderer and verification-consumer type checks                                                                                  |
| `just desktop-test`                 | Controlled read/save races, navigation, scroll mapping, authorization and close gate, existing card/image checks                                      |
| `just desktop-build`                | Main/preload and static renderer builds                                                                                                               |
| `just desktop-ui`                   | Starts a fresh live fixture and prints a browser review URL                                                                                           |
| `just desktop-ui-test`              | Headless renderer: preference failure/retry/save, navigation, image, retained reread, refresh and history                                             |
| `just desktop-native-test`          | Actual hidden Electron: preload/auth, held save response, return/continue, accepted-work drain, renderer/backend loss, startup failure and DB restart |
| `just desktop-renderer-scale`       | Actual 1,000,000-Entity SQLite fixture, renderer readiness, OS memory, caches, first/middle/last browsing                                             |
| `just desktop-renderer-scale 10000` | Smaller iteration of that scale consumer                                                                                                              |

`just desktop-install` installs the pinned npm package and Electron.
`just desktop-browser-install` installs pinned Playwright Chromium.

`just desktop-task-preview` opens a live task-panel review with completed and
incomplete imports. Its stable sample library is `target/task-panel-sample/library`;
the preview URL and library path are written to `target/task-panel-sample/connection.json`.
The script recreates real tasks on each run, since tasks are run-local. It preserves
the sample files/library on exit and never uses `LOCUS_DATA_DIR` to choose a seed target.
For a separate desktop UI session, stop the preview before pointing `LOCUS_DATA_DIR`
at that sample library; opening its database alone does not restore task records.

`just desktop-notification-preview` adds a preview-only **Show examples** control
to the actual application. It demonstrates success, info, warning, retry and
loading-to-success toasts, all labeled **Example**. Its separate renderer/library
live in `target/notification-sample`; none of these examples enter production builds.

Evidence JSON/screenshots go into `target/desktop-*`; set `LOCUS_VERIFY_OUTPUT`
for an explicit output directory.

The browser preview's Node proxy injects authorization without exporting credentials
to browser data. Its narrow bridge substitute is verification-only and does not
prove the production native-close seam. Ctrl+C drains the preview backend and removes
its fixture. Transport faults and bounded SQLite trigger work remain in isolated
verification fixtures; production APIs have no fault-injection hooks. The scale
consumer states Entity count separately from DB rows and records actual renderer
memory; the local sample selects no universal performance threshold.

## Explicit specimen preview

`just desktop-ui-specimens` starts Vite. Open
`/?preview=specimens#/entity` at the printed origin. This labeled mode retains the
earlier gallery/Twitter/video examples with temporary view choices, opens no library
and saves no preferences. It is never a fallback for failed live data. Production
builds omit these specimen inputs.

Regenerate synthetic video fixtures with
`node apps/desktop/scripts/generate-video-specimens.mjs`, with ffmpeg on PATH or
`LOCUS_FFMPEG` configured. This is unrelated to live video playback.

## Ownership

`src/main` owns native process/session/exit coordination; `src/preload` installs
the narrow bridge and `src/shared` holds its pure contract. Renderer `app` owns
the run lifetime, routing and close UI; `pages/entity` composes browsing/inspection;
`entities/entity` owns bounded observations/projections;
`features/entity-view-preferences` coordinates choices; `shared/api` consumes
`@locus/client`. Desktop and client retain independent npm lockfiles.

Personal Tags are available from **Tags** in the navigation rail, even with no
Entity selected. Create, rename or globally delete vocabulary records there.
Browse the forest in columns: selecting a tag opens its children to the right,
and selecting a sibling replaces that branch. Each row shows direct child and
total descendant counts (excluding itself). Deep paths scroll horizontally;
each column scrolls vertically. Search results show the full path and reveal it
on selection. The selection, search and scroll positions survive page reentry
within the current library session.
**Overview → Personal tags** searches existing names and saves each assignment
addition/removal immediately. Creating a vocabulary record does not assign it.
The **Tags** component panel shows retained set identity and stable Tag IDs.
Names are trimmed, nonblank and case-sensitive (`cat` and `Cat` are distinct).
Global deletion removes all assignments, including unmounted retained sets,
while preserving every Entity. Rename and deletion leave Filter drafts and
established identity results unchanged until explicit Apply/Refresh.

Filter's field catalogue supplies `tag_names_exact` for whole-name matching and
`tag_ids` for stable identity. Examples: `tag_names_exact:"cat"` and
`tag_ids:"<copied Tag ID>"`. Use the supplied native reference shown in the
catalogue and quote names containing spaces or query punctuation.

Unconfirmed Tag writes remain reachable through the navigation's unresolved
count and the vocabulary manager after navigation or closing the dialog.
**Recover original request** observes the captured request; if the same run has
no binding, it explicitly redelivers only that original request and arguments.
Confirmed writes remain confirmed when a subsequent metadata read fails.

`just desktop-tag-browser` runs the real renderer and fixture server with an
isolated synthetic library. Its test-only interception exercises delayed writes,
lost committed responses and read failures. JSON evidence and normal/small
screenshots are retained under `target/desktop-tags-*`. `just desktop-ui` opens
an isolated live preview for manual Tag acceptance.

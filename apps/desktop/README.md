# Desktop

Use `just desktop-ui` for routine UI development and verification. It serves the
same renderer through Vite on loopback without starting Electron. Open the URL
printed by Vite in an isolated in-app browser, or use a headless browser for
automated interaction and screenshot checks. Navigation, hover behavior, panels,
page layout and virtual-grid interactions can be checked there without
taking over the desktop pointer or foreground window.

Reserve native Electron checks for window controls, draggable title-bar regions,
native dialogs and host integration. Browser results do not establish those
native behaviors. Prefer browser verification by default, and explain any need
for desktop control before using it.

Run `just desktop-install`, then `just desktop-run` from the repository root for
the live Electron shell. Install uses the pinned npm lockfile and explicitly
downloads Electron's binary through its `install-electron` command; it needs no
global npm configuration changes. `just desktop-check` generates file routes and checks
the host and browser separately. `just desktop-build` writes `out/main` and
`out/renderer`; `just desktop-preview` opens those built local assets.

This is an isolated UI review consumer. It does not start Axum, open a library,
select files or expose native IPC. The connected desktop lifecycle and authorized
Axum origin remain later integration work.

`src/main` owns Electron. The renderer uses FSD: `app` owns entry, routes, styles
and the persistent shell; `pages` owns each page; `shared` owns Base UI shadcn
components and utilities. `components.json` points the CLI at these shared paths.
`app/route-tree.gen.ts` is generated from thin file-route adapters. Hash history
allows the same shell to navigate from local built assets. Run
`npm --prefix apps/desktop run build:renderer` to build only the renderer assets.

The Windows title bar uses native window controls and the overlay's CSS safe
area. Dark tokens and the host background are aligned before the window shows.
The Entity page has a responsive virtual grid and single selection. Development
loads offline synthetic records from `app/preview/entities.ts`; the production
renderer excludes that module and shows an empty list until backend integration.
Selection links the grid to Overview and the selected item's File/Image panels.
Home and Setting retain their minimal headings.

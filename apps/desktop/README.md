# Desktop

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
The initial pages contain only their headings, with no sample library data.

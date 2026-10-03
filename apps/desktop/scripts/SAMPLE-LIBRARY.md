# Retained comprehensive sample library

This verification consumer creates a fresh current-schema library through the
generated client and real server/domain operations. Only Civitai's external
observations are substituted by the existing fixture host. No network access,
private credentials, SQL payload seeding, old metadata database or new product
feature is involved.

From the repository root, with desktop dependencies, ffmpeg/ffprobe and the
Playwright Chromium installation available:

```text
just desktop-sample-generate
just desktop-sample-verify
just desktop-sample-preview
```

All three accept an output root as their first argument, defaulting to
`.local/comprehensive-library`. Generation refuses any nonempty destination,
including failed/partial generations, without resetting it. Choose another root
to generate again. Preview reopens the existing library, prints a local URL, and
drains the owned backend on Ctrl+C/SIGTERM. It never deletes the library. It uses
the actual renderer through the existing verification adapter; native desktop
close/restart and system-browser handoff are outside this browser preview.
Each preview writes `preview.md` with the current URL and a clickable link for
every named case; these links are valid only while that preview run is alive.
Open named case links in a new tab. Same-document hash navigation inside an
existing Civitai excursion can retain its prior model selection; verification
uses fresh tabs for direct case entries and ordinary in-page controls for version,
source, example inspection and return. It does not claim to repair deep-link or
virtualized-grid behavior.
The generation recipe's second positional argument is the optional retained
input root. Both roots accept repository-relative or absolute paths, including
spaces when quoted.

The public recipes build their required Rust executables and renderer. The shared
fixture host validates that renderer even when used only for generation.
To reuse already built current executables after cache
cleanup, set both overrides and invoke the npm entry directly. For example in
PowerShell from the repository root:

```powershell
$env:LOCUS_SERVER_BINARY = (Resolve-Path '.local/test-library-tools/fixture-server.exe').Path
$env:LOCUS_CIVITAI_INPUTS_BINARY = (Resolve-Path '.local/test-library-tools/civitai-fixture-inputs.exe').Path
npm.cmd --prefix apps/desktop run sample:generate -- E:/Project/locus/.local/comprehensive-library --real-inputs E:/Project/locus/.local/test-library-inputs/real
npm.cmd --prefix apps/desktop run sample:verify -- E:/Project/locus/.local/comprehensive-library
npm.cmd --prefix apps/desktop run sample:preview -- E:/Project/locus/.local/comprehensive-library
```

`LOCUS_SERVER_BINARY` must point to the fixture host, not the normal server, for
controlled provider observations. `LOCUS_CIVITAI_INPUTS_BINARY` selects the
existing weight-input helper; without it generation invokes
`just server-civitai-inputs`. The binaries and library must match the current
migration history. All relative roots resolve against the repository, including
when npm runs the entry in the desktop package.
`LOCUS_FFMPEG` and `LOCUS_FFPROBE` retain their existing tool-path meanings.

To append real Civitai reading samples to an existing library, stop its preview
and run these commands from `apps/desktop`:

```text
npm exec -- tsx scripts/sample-library.ts extend-civitai
npm exec -- tsx scripts/sample-library.ts verify-civitai
npm run sample:preview -- .local/comprehensive-library --port 63706
```

The explicit extension command uses the public Civitai API and downloads actual
Agnes LoRA and Deep Negative files, verifying their upstream SHA-256. Agnes has
two long trigger phrases; Deep Negative lists SafeTensor and PickleTensor files
in one version. Inputs, complete API snapshots and provenance stay under
`inputs/civitai-public`; Git contains only the reproducible acquisition consumer.
Offline provider replay includes two general-audience examples per chosen
version. The PickleTensor companion is retained as File without claiming Model
recognition or executing its contents. Repeating the extension skips registered
named cases and verifies cached weights before reuse.

`verify-civitai` checks these added records and wide/narrow renderer layouts
without requiring the old library's view preferences to equal their initial
seed values. The full `sample:verify` remains a seed-state verification and can
reject a library changed through interactive UI use. Preview's optional `--port`
preserves an existing local browser URL across a controlled restart.

If preview reports `incompatible migration history`, the retained library was
created against different development migration definitions. Startup includes the
backend's diagnostic and refuses that database. Preserve the old output and
generate a new library at an empty root, then pass that root to preview:

```text
just desktop-sample-generate .local/comprehensive-library-current
just desktop-sample-preview .local/comprehensive-library-current
```

To keep optional retained public inputs, pass the old output's `inputs/retained`
directory as the generation recipe's second argument. Generation validates and
copies these inputs; it does not reuse the incompatible database or its ledger.

Before invoking any of these commands through npm, use an existing current
`apps/desktop/out/renderer`, or run `just desktop-build`.
If necessary provision Chromium with `just desktop-browser-install`.

## Coverage and output

- File: text, JSON, Unicode filename, empty and unrecognized bytes.
- Image: distinct landscape, portrait, transparent square and tiny compositions;
  real generated previews; unsupported bytes despite an image filename.
- Video: three aspect ratios, four-second H.264/AAC clips, generated covers,
  retained metadata and manual playback.
- Model: valid intrinsic SafeTensors inspection and embedded metadata with no
  provider match; separately named malformed input that recognition rejects.
- Twitter: two images and a video independently captured from one post,
  locator-only capture, and retained association after deliberate File replacement.
- Civitai: model 1/version 10 with an independent equal-weight copy, version 30
  from two local sources, origin-listed/unmatched version 20, peer version 30
  absent from the origin, and unrelated model 2/version 10 with empty examples.
  Three varied previews per matched version exercise eligible target reuse and
  contributor attribution. Version 20 lists a remote example that is never
  admitted or fetched. Peer-only listed version 40 does not expand A's directory.
- Bilibili: three named parts of one BV, distinct CIDs and local clips, independent
  cover Entities/Files despite equal cover bytes, source-only/locator-only cases,
  and an intentionally incomplete unrecognized-cover case with playable video.

`manifest.json` contains named cases, provenance, input path, expected behavior,
Entity/File/component IDs, intended view, confirmed import facts and attributable
failures. `README.md` is the browsing guide. Managed data live in `library/`;
source specimens and controlled provider observations live in `inputs/`.
The generator leaves partial evidence if an unexpected operation fails, never a
false successful final manifest. File-only cards retain normal identity labels.

`sample:verify` refuses overwrite and checks the unchanged database hash, performs
read-only SQLite integrity/history/table checks using `uv run python`, reopens
the database with the real host, verifies retained component facts, preferences,
previews, Civitai aggregation/reuse and independent Bilibili cover identities,
then runs actual renderer interactions. It saves `verification/retained-reads.json`,
`renderer.json`, screenshots and a final `result.json`; all owned preview/browser/
backend processes stop before success. UUIDs and acquisition times vary by run;
synthetic input contents and behavior are deterministic.

## Optional retained public inputs

`--real-inputs <absolute-directory>` adds the deliberately preserved acquisition
bundle: NASA images/JSON and NASAWebb Twitter capture, Sintel, EasyNegative with
four saved previews, a real two-part Bilibili capture and Big Buck Bunny with
original cover. The bundle has `input-manifest.json` entries containing relative
path, byte count and SHA256, the original provider JSON, media under `assets/`,
`multipart/` and `civitai-previews/`, and `civitai-previews.json` mapping observation
URLs to saved preview files. All declared files are checksum-verified and copied
under the output. Original acquisition provenance remains alongside them.
Old retained Civitai snapshots, if present in that bundle, are acquisition evidence
only and never used to seed schema or payloads. The normal Civitai hash lookup and
current domain APIs match the original weight bytes against the retained response.

Omit `--real-inputs` for the complete offline synthetic baseline. The optional
bundle is local, untracked verification material, not a repository dependency.
Generated absolute roots are recorded for this local fixture; moving a completed
output is not a portability or migration feature.

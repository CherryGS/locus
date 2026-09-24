# Civitai

This provider consumes the actual admitted weight through File, streams BLAKE3,
and accepts complete model/version/concrete-file observations before processing
the matched version's examples. Its `api` facade exposes enrichment, original
continuation/confirmation, passive component/Page/source reads and a short
transaction participant for whole-operation result validation.

The pinned `provider-civitai` adapter uses `civitai.red` metadata endpoints and
the provider's validated image-preview retrieval. It supplies image representations,
not guaranteed originals. Requested video examples currently fail explicitly;
a still poster cannot satisfy requested video work. No remote weights or examples
from merely browsed versions are downloaded.

`Enrichment` is run-local recovery evidence. Retain it until the operation ends
and for explicit same-run continuation; retained records are not a durable job
journal. Failed examples preserve accepted metadata and independent target effects.
Reading or returning to the Page does not perform acquisition or Media processing.

Verification:

- `just rust-test-code locus-civitai`: real SQLite/File/Media with controlled upstream.
- `just desktop-civitai-browser`: isolated HTTP imports, Page/source/gallery,
  return/new-entry, safe text, read retry and explicit refresh.
- Set `LOCUS_PREVIEW_PROFILE=civitai`, then run `just desktop-ui` for a fresh
  interactive fixture. The printed setup identifies A/B/C and the temporary library.

The `fixture-server` example replaces only external provider responses. Normal
desktop launch uses the production `locus-server`; the fixture environment variable
is never read by that production binary.

# Embedded Entity search

The application registers `locus-query::api::Provider` implementations from the
actual domain owners and starts one `SearchService` per exclusively owned library.
SQLite remains authoritative. Migrations install invalidation triggers in the
same transaction/savepoint as every selected mutation. Journal rows are retained
for replay; this implementation does not prune them.

Tantivy 0.26.2 generations live below `cache/search`. Commit payloads bind the
library journal identity, generation, definition fingerprint and covered sequence.
SQLite acknowledgement follows a durable index commit. A reader is published
separately. Rebuilds retain the old compatible publication; active evidence
contexts lease their generation until release or expiry. The worker reclaims
expired contexts and retired generations, and checks cancellation between batches.
The application's lifetime guard is held until real worker/writer completion.

The declared analyzer lowercases contiguous alphanumeric words and emits Chinese
characters separately, preserving UTF-8 byte offsets and phrase positions. It is
deterministic, supports Latin keywords and Chinese phrases, and is not a linguistic
word segmenter. Native input retains strict Tantivy grammar and implicit OR.
Catalogue-generated exact and state fields expose equality and missing/empty
observations separately from analyzed values and native value existence.
Tantivy 0.26.2's native parser rejects `field:*` despite recognizing its grammar;
that unsupported-query error is preserved. Native `ExistsQuery` behavior is
verified independently; use catalogue state references for recorded field states.

Queries collect every hit using two numeric fast fields for UUID bytes, then sort
by score/identity or identity alone. They do not load stored documents for all
hits. The packed response has 16 bytes per identity and exact Content-Length.
Only bounded evidence reads load stored selected projections. Evidence contexts
expire after 600 seconds; a read accepts at most 128 requested Entity identities.
The context retains the Searcher and query, not a second complete result list.

`just server-search-smoke` exercises the real authorized generated client,
domain metadata, filters/evidence, reopen, and search-only degradation.
`just server-search-scale 1000000` creates an isolated temporary library and reports
index build, complete collect/sort/transfer, cache/database bytes, and process
memory. Its separate 4 MiB retained Civitai fixture measures selected-column versus
full-payload SQLite reads. Results are local measurements, not latency guarantees.

The 2026-09-28 native Windows dev-profile run (i7-14790F, 24 logical CPUs, 32 GiB
RAM, Node 24.18.0) returned all 1,000,000 unique IDs, exactly 16,000,000 bytes.
Fresh build including startup/readiness polling took 18,998 ms; complete
collect/sort/transfer/client validation took 201.26 ms. The index occupied
354,761,411 bytes and the database 82,317,312 bytes. Server process peak RSS was
381,575,168 bytes; client sampled transfer peak was 136,478,720 bytes, with
16,201,044 ArrayBuffer bytes retained after checks and explicit GC.

That fixture contained empty Entities and one additional unmounted retained
Civitai probe row. For its 4,195,141-byte payload, 100 common-column reads took
145.09 ms versus 564.64 ms for full read plus JSON decoding. SQLite reported a
primary-key index lookup. The latter is a warm SQLite/Python comparison, separate
from the Rust search timing. Full output is retained locally at
`target/search-work/search-scale-1000000.log`; rerun the recipe for fresh evidence.

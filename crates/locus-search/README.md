# Embedded Entity search

Search owns the derived Tantivy 0.26.2 index and aligned query execution. Domains
supply the catalogue and lightweight typed projections through locus-query;
locus-filter owns native source, parsed observations and durable library presets. The server
composes them without a Search-to-Filter dependency.

The index stores selected typed JSON roots, analyzed field text and aggregate
text. Fixed identity fast fields support complete packed-ID collection. Logical
presence is generated from normalized nonempty values; `field:*` matches it with
constant score one, and NOT is a zero-scoring full complement. Missing/null/empty
scalar/empty collection share the empty state. Collection members remain real
values, including an empty-string member. There are no public `*_state` fields
or stored per-document provenance blobs. Exact/analyzed public references come
from the catalogue; private JSON paths are not user query fields.

Queries enter the single worker. Final journal catch-up and Searcher capture reuse
one Store protected database scope; its Diesel participants do not reacquire the
DB resource. Native occurrence/boost semantics retain relevance, with EntityId as
the tie breaker. The explicit typed-predicate API uses the same aligned admission.

Explanation contexts retain a pinned Searcher and the whole submitted native
source. Explicit typed predicates retain their branch evidence semantics.
Contexts expire after ten minutes or explicit release; IDs remain independently
usable after explanation expiry. Compatible derived generations reopen, while
representation/catalogue changes rebuild only the derived index. Presets and
primary data are outside index cleanup.

Run `just rust-test-code locus-search`, the server Filter composition tests,
`just server-search-smoke`, `just desktop-filter-browser` and
`just desktop-renderer-scale 1000000` for executable evidence. Performance reports
are emitted by the actual isolated harness runs; measurements from the former
per-field/evidence representation do not describe this representation.

# Locus server

Build with `just server-build`. The server reads one JSON bootstrap object from
a private stdin pipe followed by EOF, then writes its ready origin and run ID to
stdout. The host supplies a fresh `credential` and may supply `library_root`.

## Library root

Production server startup selects the first configured source in this order:

1. `library_root` in the private bootstrap object.
2. The `LOCUS_DATA_DIR` environment variable.
3. The first line of `<local application data>/Locus/path`.
4. `<local application data>/Locus`, the existing default.

On Windows, the locator is `%LOCALAPPDATA%\Locus\path` and the default library is
`%LOCALAPPDATA%\Locus`. The locator always stays there, even when it points to a
library on another drive. For example, its first line can be:

```text
E:\LocusLibrary
```

For testing, set the environment variable before launching the server or its host:

```powershell
$env:LOCUS_DATA_DIR = 'E:\LocusTestLibrary'
```

The locator is UTF-8 text; an optional BOM, surrounding whitespace and CRLF are
accepted. Later lines are ignored. A missing locator or an empty first line uses
the default root. An empty environment variable, a non-absolute selected path, an
unreadable locator or a library initialization failure stops startup instead of
silently opening another library. An explicit bootstrap root takes precedence
even over an invalid environment setting.

The server creates a selected directory if needed, using the existing storage
initialization. It does not rewrite the locator, move existing data, or select a
different root while running. Metadata remains in `metadata.sqlite` under the
selected root; controlled files retain their existing layout.

The standalone desktop UI currently runs without a server. This startup setting
applies when launching `locus-server`; it does not connect the UI to a library.

## Verification

`GET /api/v1/entities` completes one task-coordinated database observation before
returning packed 16-byte RFC UUIDv7 Entity identities. It includes empty Entities,
excludes unattached components and promises no sort order across reads. Success
uses `application/octet-stream`, exact `Content-Length` (including zero), `nosniff`
and `no-store`. Failures use the existing typed JSON error responses.

`POST /api/v1/memberships/read` accepts `{ "entity_ids": ["..."] }`, with one
attributed `present`/`missing` result per input position, including duplicates.
Present results include the actual memberships and may be empty. A database or
decode failure rejects the batch. Missing owners or unreadable domain payloads
do not erase memberships. SQL bind chunks share one transaction; this route alone
is exempt from the generic 16,384-byte JSON body ceiling, without a public item
quota. Existing create-Entity POST and single-Entity reads remain available.

Both reads require current authorization/run context, participate in admission and
drain, and retain no request binding or public task. Database stages finish before
HTTP transfer; holding an unread identity response cannot hold the DB or drain.
Later memberships and payload reads observe current domain context, independently
of an earlier fixed identity sequence. Ordinary reads never interpret or generate.

`just rust-test-code locus-server` covers bootstrap parsing, isolated root
selection, HTTP behavior and the existing backend examples. `just server-smoke`
exercises the real server with a private bootstrap and temporary library.
`just server-entity-smoke` demonstrates this read path through the generated
client. `just server-entity-scale` uses a million actual Entity rows, reports
end-to-end completion and process memory, and cleans up only its temporary fixture.

Library startup runs the ordered `locus-migration` history before current services
or normal/restricted readiness. A nonempty database without that history, an
unknown newer ID, or a changed applied checksum stops startup without rewriting
the library. During development, explicitly choose a new isolated root when
history has changed. No automatic reset or legacy adoption is performed. See
[the migration authoring guide](../../crates/locus-migration/README.md).

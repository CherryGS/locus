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

`just rust-test-code locus-server` covers bootstrap parsing, isolated root
selection, HTTP behavior and the existing backend examples. `just server-smoke`
exercises the real server with a private bootstrap and temporary library.

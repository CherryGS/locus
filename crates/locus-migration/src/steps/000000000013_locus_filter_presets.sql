CREATE TABLE locus_filter_comm_preset (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL UNIQUE COLLATE BINARY CHECK(length(trim(name)) > 0),
    revision TEXT NOT NULL,
    format TEXT NOT NULL,
    version INTEGER NOT NULL CHECK(version > 0),
    source TEXT NOT NULL
);

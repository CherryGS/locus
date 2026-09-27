CREATE TABLE locus_civitai_comp_snapshot (
        id BLOB PRIMARY KEY NOT NULL CHECK(length(id)=16),
        revision INTEGER NOT NULL CHECK(revision>=0),
        model TEXT NOT NULL, matched_version TEXT NOT NULL, matched_file TEXT NOT NULL,
        payload TEXT NOT NULL);
CREATE INDEX locus_civitai_model ON locus_civitai_comp_snapshot(model,matched_version,matched_file);

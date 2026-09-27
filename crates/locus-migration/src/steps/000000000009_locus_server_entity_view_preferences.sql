CREATE TABLE locus_server_comm_entity_view_preference (
            entity_id BLOB NOT NULL PRIMARY KEY CHECK (typeof(entity_id) = 'blob' AND length(entity_id) = 16
                AND substr(hex(entity_id), 13, 1) = '7' AND substr(hex(entity_id), 17, 1) IN ('8', '9', 'A', 'B')),
            view_definition_id TEXT NOT NULL CHECK (typeof(view_definition_id) = 'text' AND length(view_definition_id) > 0),
            revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision > 0));

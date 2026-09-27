CREATE TABLE locus_file_comp_file (
        id BLOB NOT NULL PRIMARY KEY CHECK (typeof(id) = 'blob' AND length(id) = 16
            AND substr(hex(id), 13, 1) = '7' AND substr(hex(id), 17, 1) IN ('8', '9', 'A', 'B')),
        relative_path TEXT NOT NULL UNIQUE,
        byte_count INTEGER NOT NULL CHECK (typeof(byte_count) = 'integer' AND byte_count >= 0));

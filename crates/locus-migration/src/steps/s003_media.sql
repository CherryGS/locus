CREATE TABLE locus_media_comp_image (
            id BLOB PRIMARY KEY NOT NULL CHECK(typeof(id) = 'blob' AND length(id) = 16 AND substr(hex(id),13,1) = '7' AND substr(hex(id),17,1) IN ('8','9','A','B')),
            revision INTEGER NOT NULL CHECK(typeof(revision) = 'integer' AND revision >= 0),
            payload TEXT NOT NULL);
CREATE TABLE locus_media_comp_video (
            id BLOB PRIMARY KEY NOT NULL CHECK(typeof(id) = 'blob' AND length(id) = 16 AND substr(hex(id),13,1) = '7' AND substr(hex(id),17,1) IN ('8','9','A','B')),
            revision INTEGER NOT NULL CHECK(typeof(revision) = 'integer' AND revision >= 0),
            payload TEXT NOT NULL);

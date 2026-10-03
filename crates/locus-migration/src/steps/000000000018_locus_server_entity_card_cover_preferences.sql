CREATE TABLE locus_server_comm_entity_card_cover_preference (
    entity_id BLOB NOT NULL PRIMARY KEY CHECK (typeof(entity_id) = 'blob' AND length(entity_id) = 16
        AND substr(hex(entity_id), 13, 1) = '7' AND substr(hex(entity_id), 17, 1) IN ('8', '9', 'A', 'B')),
    source_component_id BLOB,
    version_id TEXT,
    target_entity_id BLOB,
    target_file_id BLOB,
    image_component_id BLOB,
    revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision > 0),
    CHECK (
        (source_component_id IS NULL AND version_id IS NULL AND target_entity_id IS NULL AND target_file_id IS NULL AND image_component_id IS NULL)
        OR (typeof(source_component_id) = 'blob' AND length(source_component_id) = 16
            AND substr(hex(source_component_id), 13, 1) = '7' AND substr(hex(source_component_id), 17, 1) IN ('8', '9', 'A', 'B')
            AND typeof(version_id) = 'text' AND length(version_id) > 0
            AND typeof(target_entity_id) = 'blob' AND length(target_entity_id) = 16
            AND substr(hex(target_entity_id), 13, 1) = '7' AND substr(hex(target_entity_id), 17, 1) IN ('8', '9', 'A', 'B')
            AND typeof(target_file_id) = 'blob' AND length(target_file_id) = 16
            AND substr(hex(target_file_id), 13, 1) = '7' AND substr(hex(target_file_id), 17, 1) IN ('8', '9', 'A', 'B')
            AND typeof(image_component_id) = 'blob' AND length(image_component_id) = 16
            AND substr(hex(image_component_id), 13, 1) = '7' AND substr(hex(image_component_id), 17, 1) IN ('8', '9', 'A', 'B'))
    )
);

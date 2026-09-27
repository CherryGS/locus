CREATE TABLE locus_core_comm_entity (
            id BLOB NOT NULL PRIMARY KEY CHECK (typeof(id) = 'blob' AND length(id) = 16
                AND substr(hex(id), 13, 1) = '7' AND substr(hex(id), 17, 1) IN ('8', '9', 'A', 'B'))
        );
CREATE TABLE locus_core_comm_component_registry (
            id BLOB NOT NULL PRIMARY KEY CHECK (typeof(id) = 'blob' AND length(id) = 16
                AND substr(hex(id), 13, 1) = '7' AND substr(hex(id), 17, 1) IN ('8', '9', 'A', 'B')),
            kind BLOB NOT NULL CHECK (typeof(kind) = 'blob' AND length(kind) = 16),
            UNIQUE (id, kind)
        );
CREATE TABLE locus_core_rela_membership (
            entity BLOB NOT NULL,
            kind BLOB NOT NULL,
            component BLOB NOT NULL,
            PRIMARY KEY (entity, kind),
            FOREIGN KEY (entity) REFERENCES locus_core_comm_entity(id) ON DELETE CASCADE,
            FOREIGN KEY (component, kind) REFERENCES locus_core_comm_component_registry(id, kind) ON DELETE RESTRICT
        );
CREATE UNIQUE INDEX locus_memberships_exclusive ON locus_core_rela_membership(component);

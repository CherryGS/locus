CREATE TABLE locus_tag_comm_tag (id BLOB PRIMARY KEY NOT NULL CHECK(length(id)=16), name TEXT NOT NULL COLLATE BINARY UNIQUE CHECK(length(name)>0), revision TEXT NOT NULL);
CREATE TABLE locus_tag_comp_set (id BLOB PRIMARY KEY NOT NULL CHECK(length(id)=16));
CREATE TABLE locus_tag_rela_assignment (tag_set BLOB NOT NULL REFERENCES locus_tag_comp_set(id) ON DELETE CASCADE, tag BLOB NOT NULL REFERENCES locus_tag_comm_tag(id) ON DELETE CASCADE, PRIMARY KEY(tag_set,tag));
CREATE INDEX locus_tag_assignment_tag ON locus_tag_rela_assignment(tag,tag_set);
CREATE TRIGGER locus_search_tag_assignment_insert AFTER INSERT ON locus_tag_rela_assignment BEGIN
 INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.tag_set;
END;
CREATE TRIGGER locus_search_tag_assignment_delete AFTER DELETE ON locus_tag_rela_assignment BEGIN
 INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.tag_set;
END;
CREATE TRIGGER locus_search_tag_assignment_update AFTER UPDATE ON locus_tag_rela_assignment BEGIN
 INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.tag_set OR component=NEW.tag_set;
END;
CREATE TRIGGER locus_search_tag_rename AFTER UPDATE ON locus_tag_comm_tag BEGIN
 INSERT INTO locus_search_comm_invalidation(entity) SELECT m.entity FROM locus_core_rela_membership m JOIN locus_tag_rela_assignment a ON a.tag_set=m.component WHERE a.tag=OLD.id OR a.tag=NEW.id;
END;

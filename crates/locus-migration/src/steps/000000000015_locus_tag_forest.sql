ALTER TABLE locus_tag_comm_tag ADD COLUMN parent BLOB REFERENCES locus_tag_comm_tag(id) CHECK(parent IS NULL OR length(parent)=16);
CREATE INDEX locus_tag_comm_tag_parent ON locus_tag_comm_tag(parent);
DROP TRIGGER locus_search_tag_rename;
CREATE TRIGGER locus_search_tag_rename AFTER UPDATE OF name ON locus_tag_comm_tag WHEN OLD.name != NEW.name BEGIN
 INSERT INTO locus_search_comm_invalidation(entity) SELECT m.entity FROM locus_core_rela_membership m JOIN locus_tag_rela_assignment a ON a.tag_set=m.component WHERE a.tag=OLD.id OR a.tag=NEW.id;
END;

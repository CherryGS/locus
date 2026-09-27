CREATE TABLE locus_search_comm_journal_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), identity TEXT NOT NULL, head INTEGER NOT NULL DEFAULT 0, acknowledged INTEGER NOT NULL DEFAULT 0);
INSERT INTO locus_search_comm_journal_identity(singleton,identity) VALUES(1,lower(hex(randomblob(16))));
CREATE TABLE locus_search_comm_invalidation (sequence INTEGER PRIMARY KEY AUTOINCREMENT, entity BLOB NOT NULL CHECK(length(entity)=16));
CREATE TRIGGER locus_search_journal_head AFTER INSERT ON locus_search_comm_invalidation BEGIN UPDATE locus_search_comm_journal_identity SET head=NEW.sequence WHERE singleton=1; END;
CREATE TRIGGER locus_search_entity_insert AFTER INSERT ON locus_core_comm_entity BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT NEW.id;
END;
CREATE TRIGGER locus_search_entity_update AFTER UPDATE ON locus_core_comm_entity BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT OLD.id;
INSERT INTO locus_search_comm_invalidation(entity) SELECT NEW.id;
END;
CREATE TRIGGER locus_search_entity_delete AFTER DELETE ON locus_core_comm_entity BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT OLD.id;
END;
CREATE TRIGGER locus_search_membership_insert AFTER INSERT ON locus_core_rela_membership BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT NEW.entity;
END;
CREATE TRIGGER locus_search_membership_update AFTER UPDATE ON locus_core_rela_membership BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT OLD.entity;
INSERT INTO locus_search_comm_invalidation(entity) SELECT NEW.entity;
END;
CREATE TRIGGER locus_search_membership_delete AFTER DELETE ON locus_core_rela_membership BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT OLD.entity;
END;
CREATE TRIGGER locus_search_file_insert AFTER INSERT ON locus_file_comp_file BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.id;
END;
CREATE TRIGGER locus_search_file_update AFTER UPDATE ON locus_file_comp_file BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.id;
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.id;
END;
CREATE TRIGGER locus_search_file_delete AFTER DELETE ON locus_file_comp_file BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.id;
END;
CREATE TRIGGER locus_search_image_insert AFTER INSERT ON locus_media_comp_image BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.id;
END;
CREATE TRIGGER locus_search_image_update AFTER UPDATE ON locus_media_comp_image BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.id;
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.id;
END;
CREATE TRIGGER locus_search_image_delete AFTER DELETE ON locus_media_comp_image BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.id;
END;
CREATE TRIGGER locus_search_video_insert AFTER INSERT ON locus_media_comp_video BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.id;
END;
CREATE TRIGGER locus_search_video_update AFTER UPDATE ON locus_media_comp_video BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.id;
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.id;
END;
CREATE TRIGGER locus_search_video_delete AFTER DELETE ON locus_media_comp_video BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.id;
END;
CREATE TRIGGER locus_search_model_insert AFTER INSERT ON locus_model_comp_model BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.id;
END;
CREATE TRIGGER locus_search_model_update AFTER UPDATE ON locus_model_comp_model BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.id;
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.id;
END;
CREATE TRIGGER locus_search_model_delete AFTER DELETE ON locus_model_comp_model BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.id;
END;
CREATE TRIGGER locus_search_twitter_insert AFTER INSERT ON locus_twitter_comp_snapshot BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.id;
END;
CREATE TRIGGER locus_search_twitter_update AFTER UPDATE ON locus_twitter_comp_snapshot BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.id;
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.id;
END;
CREATE TRIGGER locus_search_twitter_delete AFTER DELETE ON locus_twitter_comp_snapshot BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.id;
END;
CREATE TRIGGER locus_search_bilibili_insert AFTER INSERT ON locus_bilibili_comp_snapshot BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.id;
END;
CREATE TRIGGER locus_search_bilibili_update AFTER UPDATE ON locus_bilibili_comp_snapshot BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.id;
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.id;
END;
CREATE TRIGGER locus_search_bilibili_delete AFTER DELETE ON locus_bilibili_comp_snapshot BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.id;
END;
CREATE TRIGGER locus_search_civitai_insert AFTER INSERT ON locus_civitai_comp_snapshot BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.id;
END;
CREATE TRIGGER locus_search_civitai_update AFTER UPDATE ON locus_civitai_comp_snapshot BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.id;
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=NEW.id;
END;
CREATE TRIGGER locus_search_civitai_delete AFTER DELETE ON locus_civitai_comp_snapshot BEGIN
INSERT INTO locus_search_comm_invalidation(entity) SELECT entity FROM locus_core_rela_membership WHERE component=OLD.id;
END;

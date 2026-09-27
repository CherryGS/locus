CREATE TABLE locus_server_comm_access_credential(singleton INTEGER PRIMARY KEY CHECK(singleton=1), context_id TEXT NOT NULL, revision TEXT NOT NULL, token TEXT NOT NULL);
CREATE TABLE locus_server_rela_access_eligibility(context_id TEXT NOT NULL, file_id TEXT NOT NULL, PRIMARY KEY(context_id,file_id));

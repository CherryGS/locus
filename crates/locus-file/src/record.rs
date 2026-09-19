use crate::{FileError, FileId, FileStorage};
use diesel::{
    OptionalExtension, QueryableByName, sql_query,
    sql_types::{BigInt, Binary, Text},
};
use diesel_async::RunQueryDsl;
use locus_store::{Context, Session};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileRecord {
    pub id: FileId,
    pub relative_path: String,
    pub byte_count: u64,
}
#[derive(QueryableByName)]
struct RecordRow {
    #[diesel(sql_type = Binary)]
    id: Vec<u8>,
    #[diesel(sql_type = Text)]
    relative_path: String,
    #[diesel(sql_type = BigInt)]
    byte_count: i64,
}
impl FileStorage {
    /// Reads metadata only: no filesystem probe, interpretation or health check.
    pub async fn lookup(&self, session: &mut Session, id: FileId) -> Result<FileRecord, FileError> {
        session
            .transaction(move |context| Box::pin(Self::lookup_in(context, id)))
            .await
    }
    pub async fn lookup_in(context: &mut Context, id: FileId) -> Result<FileRecord, FileError> {
        let row = sql_query("SELECT id, relative_path, byte_count FROM locus_files WHERE id = ?")
            .bind::<Binary, _>(id.as_bytes().as_slice())
            .get_result::<RecordRow>(context.connection())
            .await
            .optional()?
            .ok_or(FileError::MissingRecord(id))?;
        let record = FileRecord {
            id: FileId::from_bytes(&row.id)?,
            relative_path: row.relative_path,
            byte_count: u64::try_from(row.byte_count).map_err(|_| FileError::ByteCountOverflow)?,
        };
        Self::validate_location(&record)?;
        Ok(record)
    }
    pub(crate) fn validate_location(record: &FileRecord) -> Result<(), FileError> {
        if record.relative_path != record.id.relative_path() {
            return Err(FileError::InvalidLocation {
                id: record.id,
                path: record.relative_path.clone(),
            });
        }
        Ok(())
    }
}

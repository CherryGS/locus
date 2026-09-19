use crate::{error::FileError, identity::FileId, record::FileRecord, service::FileService};
use diesel::{
    OptionalExtension, QueryableByName, sql_query,
    sql_types::{BigInt, Binary, Text},
};
use diesel_async::RunQueryDsl;
use locus_core::api::ComponentId;
use locus_store::api::{Context, Session};

#[derive(QueryableByName)]
struct RecordRow {
    #[diesel(sql_type = Binary)]
    id: Vec<u8>,
    #[diesel(sql_type = Text)]
    relative_path: String,
    #[diesel(sql_type = BigInt)]
    byte_count: i64,
}
impl FileService {
    /// Reads metadata only: no filesystem probe, interpretation or health check.
    pub async fn read(&self, session: &mut Session, id: FileId) -> Result<FileRecord, FileError> {
        session
            .transaction(move |context| Box::pin(Self::read_in(context, id)))
            .await
    }
    pub async fn read_in(context: &mut Context, id: FileId) -> Result<FileRecord, FileError> {
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
}

pub(crate) async fn insert(context: &mut Context, record: &FileRecord) -> Result<(), FileError> {
    sql_query("INSERT INTO locus_files (id, relative_path, byte_count) VALUES (?, ?, ?)")
        .bind::<Binary, _>(record.id.as_bytes().as_slice())
        .bind::<Text, _>(&record.relative_path)
        .bind::<BigInt, _>(
            i64::try_from(record.byte_count).map_err(|_| FileError::ByteCountOverflow)?,
        )
        .execute(context.connection())
        .await?;

    Ok(())
}

#[derive(QueryableByName)]
struct Count {
    #[diesel(sql_type = BigInt)]
    count: i64,
}

pub(crate) async fn exists(
    context: &mut Context,
    component: ComponentId,
) -> Result<bool, diesel::result::Error> {
    let row = sql_query("SELECT count(*) AS count FROM locus_files WHERE id = ?")
        .bind::<Binary, _>(component.as_bytes().as_slice())
        .get_result::<Count>(context.connection())
        .await?;
    Ok(row.count == 1)
}

use diesel::{
    QueryableByName, sql_query,
    sql_types::{BigInt, Text},
};
use diesel_async::RunQueryDsl;
use locus_file::api::FileId;
use locus_store::api::Context;

// This retained secret is intentionally not Debug. Local authorized retrieval is
// part of the access contract; secrets never enter public task outcomes.
#[derive(Clone, QueryableByName)]
pub(crate) struct Credential {
    #[diesel(sql_type=Text)]
    pub context_id: String,
    #[diesel(sql_type=Text)]
    pub revision: String,
    #[diesel(sql_type=Text)]
    pub token: String,
}
#[derive(QueryableByName)]
struct Count {
    #[diesel(sql_type=BigInt)]
    count: i64,
}

pub(crate) fn token() -> anyhow::Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| anyhow::anyhow!("OS credential generation failed"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
pub(crate) async fn initialize(c: &mut Context) -> anyhow::Result<Credential> {
    let count = sql_query("SELECT count(*) AS count FROM locus_server_comm_access_credential")
        .get_result::<Count>(c.connection())
        .await?
        .count;
    if count == 0 {
        sql_query("INSERT INTO locus_server_comm_access_credential VALUES(1,?,?,?)")
            .bind::<Text, _>(uuid::Uuid::now_v7().to_string())
            .bind::<Text, _>(uuid::Uuid::now_v7().to_string())
            .bind::<Text, _>(token()?)
            .execute(c.connection())
            .await?;
    }
    read(c).await
}
pub(crate) async fn read(c: &mut Context) -> anyhow::Result<Credential> {
    let value=sql_query("SELECT context_id,revision,token FROM locus_server_comm_access_credential WHERE singleton=1 AND typeof(context_id)='text' AND typeof(revision)='text' AND typeof(token)='text'").get_result::<Credential>(c.connection()).await?;
    for id in [&value.context_id, &value.revision] {
        let parsed = uuid::Uuid::parse_str(id)?;
        anyhow::ensure!(
            parsed.to_string() == *id,
            "Invalid retained external access identity"
        );
    }
    anyhow::ensure!(
        value.token.len() == 64 && value.token.bytes().all(|b| b.is_ascii_hexdigit()),
        "Invalid retained external credential"
    );
    Ok(value)
}
pub(crate) async fn replace(
    c: &mut Context,
    expected: &str,
    token: String,
    revision: String,
) -> anyhow::Result<Credential> {
    let current = read(c).await?;
    anyhow::ensure!(
        current.revision == expected,
        "External credential revision changed; observe current state"
    );
    sql_query(
        "UPDATE locus_server_comm_access_credential SET revision=?,token=? WHERE singleton=1",
    )
    .bind::<Text, _>(revision)
    .bind::<Text, _>(token)
    .execute(c.connection())
    .await?;
    read(c).await
}
pub(crate) async fn eligible(c: &mut Context, context: &str, file: FileId) -> anyhow::Result<bool> {
    Ok(sql_query(
        "SELECT count(*) AS count FROM locus_server_rela_access_eligibility WHERE context_id=? AND file_id=?",
    )
    .bind::<Text, _>(context)
    .bind::<Text, _>(file.to_string())
    .get_result::<Count>(c.connection())
    .await?
    .count
        == 1)
}
pub(crate) async fn admit(c: &mut Context, context: &str, file: FileId) -> anyhow::Result<()> {
    sql_query("INSERT INTO locus_server_rela_access_eligibility(context_id,file_id) VALUES(?,?)")
        .bind::<Text, _>(context)
        .bind::<Text, _>(file.to_string())
        .execute(c.connection())
        .await?;
    Ok(())
}

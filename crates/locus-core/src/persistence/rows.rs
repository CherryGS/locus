use diesel::{
    QueryableByName,
    sql_types::{BigInt, Binary, Nullable, Text},
};

#[derive(QueryableByName)]
pub(crate) struct IdRow {
    #[diesel(sql_type = Binary)]
    pub(crate) id: Vec<u8>,
}
#[derive(QueryableByName)]
pub(crate) struct KindRow {
    #[diesel(sql_type = Binary)]
    pub(crate) kind: Vec<u8>,
}
#[derive(QueryableByName)]
pub(crate) struct NotesRow {
    #[diesel(sql_type = Text)]
    pub(crate) notes: String,
}
#[derive(QueryableByName)]
pub(crate) struct CountRow {
    #[diesel(sql_type = BigInt)]
    pub(crate) count: i64,
}
#[derive(QueryableByName)]
pub(crate) struct MembershipRow {
    #[diesel(sql_type = Binary)]
    pub(crate) entity: Vec<u8>,
    #[diesel(sql_type = Binary)]
    pub(crate) kind: Vec<u8>,
    #[diesel(sql_type = Binary)]
    pub(crate) component: Vec<u8>,
}

#[derive(QueryableByName)]
pub(crate) struct EntityMembershipRow {
    #[diesel(sql_type = Binary)]
    pub(crate) entity: Vec<u8>,
    #[diesel(sql_type = Nullable<Binary>)]
    pub(crate) kind: Option<Vec<u8>>,
    #[diesel(sql_type = Nullable<Binary>)]
    pub(crate) component: Option<Vec<u8>>,
}

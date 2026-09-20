use super::error::ApiError;
use axum::{
    Json,
    extract::{
        Path,
        rejection::{JsonRejection, PathRejection},
    },
};
pub(crate) fn canonical_id(id: &str) -> Result<uuid::Uuid, ApiError> {
    let parsed = uuid::Uuid::parse_str(id)
        .map_err(|_| ApiError::invalid("Identity must be a canonical hyphenated UUID"))?;
    if parsed.to_string() != id {
        return Err(ApiError::invalid(
            "Identity must be a canonical lowercase hyphenated UUID",
        ));
    }
    Ok(parsed)
}
pub(crate) fn path_id(path: Result<Path<String>, PathRejection>) -> Result<String, ApiError> {
    let Path(value) = path.map_err(|_| ApiError::invalid("Invalid path identity"))?;
    canonical_id(&value)?;
    Ok(value)
}
pub(crate) fn body<T>(value: Result<Json<T>, JsonRejection>) -> Result<T, ApiError> {
    value
        .map(|Json(v)| v)
        .map_err(|_| ApiError::invalid("Expected valid operation JSON"))
}

use crate::error::MigrationError;
use diesel::{
    QueryableByName, sql_query,
    sql_types::{Binary, Nullable, Text},
};
use diesel_async::RunQueryDsl;
use locus_store::api::Context;
fn column(value: Option<&serde_json::Value>, kind: &str) -> Result<Option<String>, String> {
    use serde_json::Value;
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(v)) if kind == "text" => Ok(Some(v.clone())),
        Some(Value::Number(v)) if kind == "uint" && v.as_u64().is_some() => Ok(Some(v.to_string())),
        Some(Value::Number(v)) if kind == "int" && v.as_i64().is_some() => Ok(Some(v.to_string())),
        Some(Value::Number(v)) if kind == "float" && v.as_f64().is_some_and(f64::is_finite) => {
            Ok(Some(v.to_string()))
        }
        Some(Value::Array(v)) if kind == "collection" && v.iter().all(Value::is_string) => {
            Ok(Some(serde_json::to_string(v).map_err(|e| e.to_string())?))
        }
        _ => Err("malformed selected common field".into()),
    }
}
fn selected(mut value: serde_json::Value, owner: &str) -> Result<serde_json::Value, String> {
    if owner == "model" && !value.is_null() {
        if value["format"].as_str().is_none()
            || value["tensor_count"].as_u64().is_none()
            || value["element_count"].as_u64().is_none()
        {
            return Err("invalid required Model summary".into());
        }
        let keys = value
            .get("storage_types")
            .and_then(serde_json::Value::as_object)
            .ok_or("invalid Model storage types")?
            .keys()
            .cloned()
            .map(serde_json::Value::String)
            .collect();
        value["selected_storage_types"] = serde_json::Value::Array(keys);
    }
    if owner == "civitai" {
        if value["model"]["id"].as_u64().is_none()
            || value["model"]["name"].as_str().is_none()
            || value["model"]["type"].as_str().is_none()
            || !value["model"]["tags"].is_array()
        {
            return Err("invalid required Civitai model fields".into());
        }
        let version = value["matched_version"]
            .as_u64()
            .ok_or("missing matched version")?;
        let file = value["matched_file"]
            .as_u64()
            .ok_or("missing matched file")?;
        let versions = value["model"]["modelVersions"]
            .as_array()
            .ok_or("missing origin hierarchy")?;
        let matches: Vec<_> = versions
            .iter()
            .filter(|v| v["id"].as_u64() == Some(version))
            .collect();
        if matches.len() != 1 {
            return Err("ambiguous matched version".into());
        }
        let selected = matches[0].clone();
        let files = selected["files"].as_array().ok_or("missing origin files")?;
        let matches: Vec<_> = files
            .iter()
            .filter(|v| v["id"].as_u64() == Some(file))
            .collect();
        if matches.len() != 1 {
            return Err("ambiguous matched file".into());
        }
        value["selected_file"] = matches[0].clone();
        value["selected_version"] = selected;
        if value["selected_version"]["name"].as_str().is_none()
            || value["selected_file"]["name"].as_str().is_none()
            || value["selected_file"]["type"].as_str().is_none()
        {
            return Err("invalid required Civitai matched fields".into());
        }
    }
    Ok(value)
}
#[derive(QueryableByName)]
struct Row {
    #[diesel(sql_type=Binary)]
    id: Vec<u8>,
    #[diesel(sql_type=Text)]
    payload: String,
}
pub(super) async fn convert(c: &mut Context) -> Result<(), MigrationError> {
    {
        let mut after = Vec::<u8>::new();
        loop {
            let rows=sql_query("SELECT id,payload FROM locus_twitter_comp_snapshot WHERE id>? ORDER BY id LIMIT 32").bind::<Binary,_>(&after).load::<Row>(c.connection()).await?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                after = row.id.clone();
                let payload: serde_json::Value = serde_json::from_str(&row.payload)
                    .map_err(|e| MigrationError::Incompatible(e.to_string()))?;
                if payload["version"] != 1 || payload.get("snapshot").is_none() {
                    return Err(MigrationError::Incompatible(
                        "unsupported or malformed historical payload".into(),
                    ));
                }
                if !payload["snapshot"].is_object() {
                    return Err(MigrationError::Incompatible("malformed snapshot".into()));
                }
                let value = selected(payload["snapshot"].clone(), "twitter")
                    .map_err(MigrationError::Incompatible)?;
                sql_query("UPDATE locus_twitter_comp_snapshot SET q_post_id=?,q_page_url=?,q_requested_url=?,q_text=?,q_author_id=?,q_author_handle=?,q_author_name=?,q_hashtags=?,q_published_at=?,q_observed_at=? WHERE id=?")
.bind::<Nullable<Text>,_>(column(value.pointer("/post_id"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/page_url"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/requested_url"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/text"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/author/user_id"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/author/handle"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/author/display_name"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/hashtags"),"collection").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/published_at_unix_ms"),"int").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/observed_at_unix_ms"),"int").map_err(MigrationError::Incompatible)?)
.bind::<Binary,_>(&row.id).execute(c.connection()).await?;
            }
        }
    }
    {
        let mut after = Vec::<u8>::new();
        loop {
            let rows=sql_query("SELECT id,payload FROM locus_bilibili_comp_snapshot WHERE id>? ORDER BY id LIMIT 32").bind::<Binary,_>(&after).load::<Row>(c.connection()).await?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                after = row.id.clone();
                let payload: serde_json::Value = serde_json::from_str(&row.payload)
                    .map_err(|e| MigrationError::Incompatible(e.to_string()))?;
                if payload["version"] != 1 || payload.get("snapshot").is_none() {
                    return Err(MigrationError::Incompatible(
                        "unsupported or malformed historical payload".into(),
                    ));
                }
                if !payload["snapshot"].is_object() {
                    return Err(MigrationError::Incompatible("malformed snapshot".into()));
                }
                let value = selected(payload["snapshot"].clone(), "bilibili")
                    .map_err(MigrationError::Incompatible)?;
                sql_query("UPDATE locus_bilibili_comp_snapshot SET q_bvid=?,q_aid=?,q_page_url=?,q_title=?,q_description=?,q_author_id=?,q_author_name=?,q_tags=?,q_published_at=?,q_observed_at=?,q_part_cid=?,q_part_number=?,q_part_title=? WHERE id=?")
.bind::<Nullable<Text>,_>(column(value.pointer("/bvid"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/aid"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/page_url"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/title"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/description"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/author/user_id"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/author/display_name"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/tags"),"collection").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/published_at_unix_ms"),"int").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/observed_at_unix_ms"),"int").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/part/cid"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/part/number"),"uint").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/part/title"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Binary,_>(&row.id).execute(c.connection()).await?;
            }
        }
    }
    {
        let mut after = Vec::<u8>::new();
        loop {
            let rows=sql_query("SELECT id,payload FROM locus_civitai_comp_snapshot WHERE id>? ORDER BY id LIMIT 32").bind::<Binary,_>(&after).load::<Row>(c.connection()).await?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                after = row.id.clone();
                let payload: serde_json::Value = serde_json::from_str(&row.payload)
                    .map_err(|e| MigrationError::Incompatible(e.to_string()))?;
                if payload["version"] != 1 || payload.get("snapshot").is_none() {
                    return Err(MigrationError::Incompatible(
                        "unsupported or malformed historical payload".into(),
                    ));
                }
                if !payload["snapshot"].is_object() {
                    return Err(MigrationError::Incompatible("malformed snapshot".into()));
                }
                let value = selected(payload["snapshot"].clone(), "civitai")
                    .map_err(MigrationError::Incompatible)?;
                let projection_error = ["format", "fp", "size"].into_iter().find_map(|key| {
                    value["selected_file"]["metadata"]
                        .get(key)
                        .filter(|v| !v.is_null() && !v.is_string())
                        .map(|_| format!("civitai_file_{key}: expected a string or null"))
                });
                sql_query("UPDATE locus_civitai_comp_snapshot SET q_projection_error=?,q_model_id=?,q_model_name=?,q_model_type=?,q_model_description=?,q_model_tags=?,q_creator=?,q_version_id=?,q_version_name=?,q_version_description=?,q_base_model=?,q_file_id=?,q_file_name=?,q_file_type=?,q_file_format=?,q_file_fp=?,q_file_size=? WHERE id=?")
.bind::<Nullable<Text>,_>(projection_error)
.bind::<Nullable<Text>,_>(column(value.pointer("/model/id"),"uint").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/model/name"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/model/type"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/model/description"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/model/tags"),"collection").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/model/creator/username"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/selected_version/id"),"uint").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/selected_version/name"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/selected_version/description"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/selected_version/baseModel"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/selected_file/id"),"uint").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/selected_file/name"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/selected_file/type"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/selected_file/metadata/format").filter(|v|v.is_string()),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/selected_file/metadata/fp").filter(|v|v.is_string()),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/selected_file/metadata/size").filter(|v|v.is_string()),"text").map_err(MigrationError::Incompatible)?)
.bind::<Binary,_>(&row.id).execute(c.connection()).await?;
            }
        }
    }
    {
        let mut after = Vec::<u8>::new();
        loop {
            let rows = sql_query(
                "SELECT id,payload FROM locus_model_comp_model WHERE id>? ORDER BY id LIMIT 32",
            )
            .bind::<Binary, _>(&after)
            .load::<Row>(c.connection())
            .await?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                after = row.id.clone();
                let payload: serde_json::Value = serde_json::from_str(&row.payload)
                    .map_err(|e| MigrationError::Incompatible(e.to_string()))?;
                if payload["version"] != 1 || payload.get("facts").is_none() {
                    return Err(MigrationError::Incompatible(
                        "unsupported or malformed historical payload".into(),
                    ));
                }
                if !(payload["facts"].is_null() || payload["facts"].is_object())
                    || payload.get("basis").is_none()
                    || payload["facts"].is_null() != payload["basis"].is_null()
                {
                    return Err(MigrationError::Incompatible("Model facts/basis".into()));
                }
                let value = selected(payload["facts"].clone(), "model")
                    .map_err(MigrationError::Incompatible)?;
                sql_query("UPDATE locus_model_comp_model SET facts_present=?,q_format=?,q_tensor_count=?,q_element_count=?,q_storage_types=? WHERE id=?")
.bind::<Text,_>(if value.is_null(){"0"}else{"1"})
.bind::<Nullable<Text>,_>(column(value.pointer("/format"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/tensor_count"),"uint").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/element_count"),"uint").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(value.pointer("/selected_storage_types"),"collection").map_err(MigrationError::Incompatible)?)
.bind::<Binary,_>(&row.id).execute(c.connection()).await?;
            }
        }
    }
    {
        let mut after = Vec::<u8>::new();
        loop {
            let rows = sql_query(
                "SELECT id,payload FROM locus_media_comp_image WHERE id>? ORDER BY id LIMIT 32",
            )
            .bind::<Binary, _>(&after)
            .load::<Row>(c.connection())
            .await?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                after = row.id.clone();
                let mut payload: serde_json::Value = serde_json::from_str(&row.payload)
                    .map_err(|e| MigrationError::Incompatible(e.to_string()))?;
                if payload["version"] != 1
                    || payload.get("facts").is_none()
                    || payload.get("basis").is_none()
                    || payload["facts"].is_null() != payload["basis"].is_null()
                {
                    return Err(MigrationError::Incompatible(
                        "unsupported Media payload".into(),
                    ));
                }
                let facts = payload["facts"].clone();
                let present = !facts.is_null();
                let body = &facts["Image"];
                if present && !body.is_object() {
                    return Err(MigrationError::Incompatible("Media facts kind".into()));
                }
                payload
                    .as_object_mut()
                    .ok_or_else(|| MigrationError::Incompatible("Media payload".into()))?
                    .remove("facts");
                payload["version"] = 2.into();
                sql_query("UPDATE locus_media_comp_image SET payload=?,facts_present=?,format=?,container=?,stream_index=?,codec=?,width=?,height=?,duration_seconds=?,duration_precision=? WHERE id=?")
.bind::<Text,_>(payload.to_string()).bind::<Nullable<Text>,_>(Some(if present{"1"}else{"0"}))
.bind::<Nullable<Text>,_>(column(body.pointer("/format"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(body.pointer("/container"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(body.pointer("/stream_index"),"uint").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(body.pointer("/codec"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(body.pointer("/width"),"uint").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(body.pointer("/height"),"uint").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(body.pointer("/duration/seconds"),"float").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(body.pointer("/duration/precision"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Binary,_>(&row.id).execute(c.connection()).await?;
            }
        }
    }
    {
        let mut after = Vec::<u8>::new();
        loop {
            let rows = sql_query(
                "SELECT id,payload FROM locus_media_comp_video WHERE id>? ORDER BY id LIMIT 32",
            )
            .bind::<Binary, _>(&after)
            .load::<Row>(c.connection())
            .await?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                after = row.id.clone();
                let mut payload: serde_json::Value = serde_json::from_str(&row.payload)
                    .map_err(|e| MigrationError::Incompatible(e.to_string()))?;
                if payload["version"] != 1
                    || payload.get("facts").is_none()
                    || payload.get("basis").is_none()
                    || payload["facts"].is_null() != payload["basis"].is_null()
                {
                    return Err(MigrationError::Incompatible(
                        "unsupported Media payload".into(),
                    ));
                }
                let facts = payload["facts"].clone();
                let present = !facts.is_null();
                let body = &facts["Video"];
                if present && !body.is_object() {
                    return Err(MigrationError::Incompatible("Media facts kind".into()));
                }
                payload
                    .as_object_mut()
                    .ok_or_else(|| MigrationError::Incompatible("Media payload".into()))?
                    .remove("facts");
                payload["version"] = 2.into();
                sql_query("UPDATE locus_media_comp_video SET payload=?,facts_present=?,format=?,container=?,stream_index=?,codec=?,width=?,height=?,duration_seconds=?,duration_precision=? WHERE id=?")
.bind::<Text,_>(payload.to_string()).bind::<Nullable<Text>,_>(Some(if present{"1"}else{"0"}))
.bind::<Nullable<Text>,_>(column(body.pointer("/format"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(body.pointer("/container"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(body.pointer("/stream_index"),"uint").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(body.pointer("/codec"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(body.pointer("/width"),"uint").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(body.pointer("/height"),"uint").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(body.pointer("/duration/seconds"),"float").map_err(MigrationError::Incompatible)?)
.bind::<Nullable<Text>,_>(column(body.pointer("/duration/precision"),"text").map_err(MigrationError::Incompatible)?)
.bind::<Binary,_>(&row.id).execute(c.connection()).await?;
            }
        }
    }
    Ok(())
}

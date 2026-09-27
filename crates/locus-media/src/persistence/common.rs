use crate::{
    error::MediaError,
    facts::{DurationPrecision, Facts, ImageFacts, ImageFormat, StreamDuration, VideoFacts},
    identity::{MediaId, MediaKind},
};
use diesel::{
    QueryableByName, sql_query,
    sql_types::{Binary, Nullable, Text},
};
use diesel_async::RunQueryDsl;
use locus_store::api::Context;
#[derive(QueryableByName)]
pub(crate) struct Common {
    #[diesel(sql_type=Nullable<Text>)]
    pub facts_present: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    pub format: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    pub container: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    pub stream_index: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    pub codec: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    pub width: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    pub height: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    pub duration_seconds: Option<String>,
    #[diesel(sql_type=Nullable<Text>)]
    pub duration_precision: Option<String>,
}
fn parse<T: std::str::FromStr>(v: &Option<String>) -> Result<Option<T>, MediaError> {
    v.as_ref()
        .map(|v| {
            v.parse()
                .map_err(|_| MediaError::Corrupt("invalid Media common column".into()))
        })
        .transpose()
}
impl Common {
    pub(crate) async fn read(c: &mut Context, id: MediaId) -> Result<Self, MediaError> {
        let table = match id.kind() {
            MediaKind::Image => "locus_media_comp_image",
            MediaKind::Video => "locus_media_comp_video",
        };
        sql_query(format!("SELECT facts_present,format,container,stream_index,codec,width,height,duration_seconds,duration_precision FROM {table} WHERE id=?"))
.bind::<Binary,_>(id.component().as_bytes().as_slice()).get_result(c.connection()).await.map_err(MediaError::from)
    }
    pub(crate) fn facts(&self, kind: MediaKind) -> Result<Option<Facts>, MediaError> {
        let corrupt = || MediaError::Corrupt("inconsistent Media common columns".into());
        match self.facts_present.as_deref() {
            Some("0") => {
                if [
                    &self.format,
                    &self.container,
                    &self.stream_index,
                    &self.codec,
                    &self.width,
                    &self.height,
                    &self.duration_seconds,
                    &self.duration_precision,
                ]
                .iter()
                .any(|v| v.is_some())
                {
                    return Err(corrupt());
                }
                Ok(None)
            }
            Some("1") => Ok(Some(match kind {
                MediaKind::Image => {
                    let format = match self.format.as_deref() {
                        Some("Png") => ImageFormat::Png,
                        Some("Jpeg") => ImageFormat::Jpeg,
                        Some("WebP") => ImageFormat::WebP,
                        Some("Gif") => ImageFormat::Gif,
                        _ => return Err(corrupt()),
                    };
                    if [
                        &self.container,
                        &self.stream_index,
                        &self.codec,
                        &self.duration_seconds,
                        &self.duration_precision,
                    ]
                    .iter()
                    .any(|v| v.is_some())
                    {
                        return Err(corrupt());
                    }
                    let width = parse(&self.width)?.ok_or_else(corrupt)?;
                    let height = parse(&self.height)?.ok_or_else(corrupt)?;
                    if width == 0 || height == 0 {
                        return Err(corrupt());
                    }
                    Facts::Image(ImageFacts {
                        format,
                        width,
                        height,
                    })
                }
                MediaKind::Video => {
                    if self.format.is_some() {
                        return Err(corrupt());
                    }
                    let duration = match (
                        parse::<f64>(&self.duration_seconds)?,
                        self.duration_precision.as_deref(),
                    ) {
                        (None, None) => None,
                        (Some(seconds), Some("Unknown"))
                            if seconds.is_finite() && (0.0..=315_576_000.0).contains(&seconds) =>
                        {
                            Some(StreamDuration {
                                seconds,
                                precision: DurationPrecision::Unknown,
                            })
                        }
                        _ => return Err(corrupt()),
                    };
                    let container = self.container.clone().ok_or_else(corrupt)?;
                    let width = parse(&self.width)?;
                    let height = parse(&self.height)?;
                    if !matches!(container.as_str(), "mov" | "matroska")
                        || width == Some(0)
                        || height == Some(0)
                        || self
                            .codec
                            .as_ref()
                            .is_some_and(|v| v.is_empty() || v.len() > 128)
                    {
                        return Err(corrupt());
                    }
                    Facts::Video(VideoFacts {
                        container,
                        stream_index: parse(&self.stream_index)?.ok_or_else(corrupt)?,
                        codec: self.codec.clone(),
                        width,
                        height,
                        duration,
                    })
                }
            })),
            _ => Err(corrupt()),
        }
    }
}
pub(crate) async fn write(
    c: &mut Context,
    id: MediaId,
    facts: &Option<Facts>,
) -> Result<(), MediaError> {
    let mut values: Vec<Option<String>> = vec![None; 8];
    match facts {
        Some(Facts::Image(f)) => {
            values[0] = Some(format!("{:?}", f.format));
            values[4] = Some(f.width.to_string());
            values[5] = Some(f.height.to_string());
        }
        Some(Facts::Video(f)) => {
            values[1] = Some(f.container.clone());
            values[2] = Some(f.stream_index.to_string());
            values[3] = f.codec.clone();
            values[4] = f.width.map(|v| v.to_string());
            values[5] = f.height.map(|v| v.to_string());
            if let Some(d) = &f.duration {
                values[6] = Some(d.seconds.to_string());
                values[7] = Some("Unknown".into());
            }
        }
        None => (),
    }
    let table = match id.kind() {
        MediaKind::Image => "locus_media_comp_image",
        MediaKind::Video => "locus_media_comp_video",
    };
    let mut query=sql_query(format!("UPDATE {table} SET facts_present=?,format=?,container=?,stream_index=?,codec=?,width=?,height=?,duration_seconds=?,duration_precision=? WHERE id=?")).into_boxed().bind::<Text,_>(if facts.is_some(){"1"}else{"0"});
    for value in values {
        query = query.bind::<Nullable<Text>, _>(value);
    }
    query
        .bind::<Binary, _>(id.component().as_bytes().as_slice())
        .execute(c.connection())
        .await?;
    Ok(())
}

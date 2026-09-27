use crate::{
    facts::Facts,
    identity::{ImageId, MediaKind, VideoId},
    persistence::common::Common,
};
use locus_core::api::{ComponentId, KindId};
use locus_query::api::*;
use locus_store::api::Context;
pub struct ImageQueryProvider;
pub struct VideoQueryProvider;
fn value(field: &str, id: ComponentId, value: Option<Value>) -> FieldValue {
    FieldValue {
        field: field.into(),
        component: Some(id.to_string()),
        value: match value {
            None => ValueState::Missing,
            Some(Value::Identifier(v)) if v.is_empty() => ValueState::Empty,
            Some(v) => ValueState::Values(vec![v]),
        },
    }
}
impl Provider for ImageQueryProvider {
    fn kind(&self) -> KindId {
        crate::identity::IMAGE_KIND
    }
    fn definitions(&self) -> Vec<FieldDefinition> {
        vec![
            {
                let mut d = FieldDefinition::new(
                    "image_format",
                    "image",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                d.default_text = false;
                d.unit = None;
                d
            },
            {
                let mut d =
                    FieldDefinition::new("image_width", "image", FieldType::Uint, Shape::Scalar);
                d.default_text = false;
                d.unit = Some("pixels".into());
                d
            },
            {
                let mut d =
                    FieldDefinition::new("image_height", "image", FieldType::Uint, Shape::Scalar);
                d.default_text = false;
                d.unit = Some("pixels".into());
                d
            },
        ]
    }
    fn project<'a>(&'a self, c: &'a mut Context, id: ComponentId) -> ProjectionFuture<'a> {
        Box::pin(async move {
            let facts = Common::read(c, ImageId::from_component(id).into())
                .await
                .and_then(|r| r.facts(MediaKind::Image))
                .map_err(|e| QueryError::Projection(e.to_string()))?;
            let f = match &facts {
                Some(Facts::Image(f)) => Some(f),
                None => None,
                _ => return Err(QueryError::Projection("Media kind".into())),
            };
            Ok(vec![
                value(
                    "image_format",
                    id,
                    f.map(|f| Value::Identifier(format!("{:?}", f.format))),
                ),
                value(
                    "image_width",
                    id,
                    f.map(|f| Value::Uint(f.width.to_string())),
                ),
                value(
                    "image_height",
                    id,
                    f.map(|f| Value::Uint(f.height.to_string())),
                ),
            ])
        })
    }
}
impl Provider for VideoQueryProvider {
    fn kind(&self) -> KindId {
        crate::identity::VIDEO_KIND
    }
    fn definitions(&self) -> Vec<FieldDefinition> {
        vec![
            {
                let mut d = FieldDefinition::new(
                    "video_container",
                    "video",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                d.default_text = false;
                d.unit = None;
                d
            },
            {
                let mut d = FieldDefinition::new(
                    "video_codec",
                    "video",
                    FieldType::Identifier,
                    Shape::Scalar,
                );
                d.default_text = false;
                d.unit = None;
                d
            },
            {
                let mut d =
                    FieldDefinition::new("video_width", "video", FieldType::Uint, Shape::Scalar);
                d.default_text = false;
                d.unit = Some("pixels".into());
                d
            },
            {
                let mut d =
                    FieldDefinition::new("video_height", "video", FieldType::Uint, Shape::Scalar);
                d.default_text = false;
                d.unit = Some("pixels".into());
                d
            },
            {
                let mut d = FieldDefinition::new(
                    "video_duration",
                    "video",
                    FieldType::Float,
                    Shape::Scalar,
                );
                d.default_text = false;
                d.unit = Some("seconds".into());
                d
            },
        ]
    }
    fn project<'a>(&'a self, c: &'a mut Context, id: ComponentId) -> ProjectionFuture<'a> {
        Box::pin(async move {
            let facts = Common::read(c, VideoId::from_component(id).into())
                .await
                .and_then(|r| r.facts(MediaKind::Video))
                .map_err(|e| QueryError::Projection(e.to_string()))?;
            let f = match &facts {
                Some(Facts::Video(f)) => Some(f),
                None => None,
                _ => return Err(QueryError::Projection("Media kind".into())),
            };
            Ok(vec![
                value(
                    "video_container",
                    id,
                    f.map(|f| Value::Identifier(f.container.clone())),
                ),
                value(
                    "video_codec",
                    id,
                    f.and_then(|f| f.codec.clone()).map(Value::Identifier),
                ),
                value(
                    "video_width",
                    id,
                    f.and_then(|f| f.width).map(|v| Value::Uint(v.to_string())),
                ),
                value(
                    "video_height",
                    id,
                    f.and_then(|f| f.height).map(|v| Value::Uint(v.to_string())),
                ),
                value(
                    "video_duration",
                    id,
                    f.and_then(|f| f.duration.as_ref())
                        .map(|v| Value::Float(v.seconds)),
                ),
            ])
        })
    }
}

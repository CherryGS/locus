use locus_core::{ComponentId, IdentityError, KindId};
use uuid::Uuid;

pub const IMAGE_KIND: KindId =
    KindId::from_uuid(Uuid::from_u128(0xaadf84d20dc04a818cdb901162c78321));
pub const VIDEO_KIND: KindId =
    KindId::from_uuid(Uuid::from_u128(0xf4be937560f14d048f078c9ad765e230));

macro_rules! media_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
        pub struct $name(ComponentId);
        impl $name {
            pub fn from_component(id: ComponentId) -> Self {
                Self(id)
            }
            pub fn from_bytes(bytes: &[u8]) -> Result<Self, IdentityError> {
                Ok(Self(ComponentId::from_bytes(bytes)?))
            }
            pub fn component(self) -> ComponentId {
                self.0
            }
            pub fn as_bytes(&self) -> &[u8; 16] {
                self.0.as_bytes()
            }
        }
    };
}
media_id!(ImageId);
media_id!(VideoId);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MediaKind {
    Image,
    Video,
}
impl MediaKind {
    pub fn kind(self) -> KindId {
        match self {
            Self::Image => IMAGE_KIND,
            Self::Video => VIDEO_KIND,
        }
    }
    pub(crate) fn table(self) -> &'static str {
        match self {
            Self::Image => "locus_images",
            Self::Video => "locus_videos",
        }
    }
    pub(crate) fn id(self, component: ComponentId) -> MediaId {
        match self {
            Self::Image => MediaId::Image(ImageId(component)),
            Self::Video => MediaId::Video(VideoId(component)),
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum MediaId {
    Image(ImageId),
    Video(VideoId),
}
impl MediaId {
    pub fn component(self) -> ComponentId {
        match self {
            Self::Image(id) => id.component(),
            Self::Video(id) => id.component(),
        }
    }
    pub fn kind(self) -> MediaKind {
        match self {
            Self::Image(_) => MediaKind::Image,
            Self::Video(_) => MediaKind::Video,
        }
    }
}
impl From<ImageId> for MediaId {
    fn from(id: ImageId) -> Self {
        Self::Image(id)
    }
}
impl From<VideoId> for MediaId {
    fn from(id: VideoId) -> Self {
        Self::Video(id)
    }
}

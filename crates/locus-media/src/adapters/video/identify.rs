use crate::{
    error::{AttemptFailure, FailureCode},
    service::MediaService,
};
use locus_file::api::LocalFile;
use std::io::{Read, Seek};

fn unsupported() -> AttemptFailure {
    AttemptFailure::new(
        FailureCode::UnsupportedInput,
        "expected an allowed movie BMFF brand set or WebM/Matroska EBML header",
    )
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Family {
    Mov,
    Matroska,
}
impl Family {
    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Mov => "mov",
            Self::Matroska => "matroska",
        }
    }
}
fn vint(bytes: &[u8], offset: &mut usize, keep_marker: bool) -> Option<u64> {
    let first = *bytes.get(*offset)?;
    let width = first.leading_zeros() as usize + 1;
    if width > 8 {
        return None;
    }
    let mut value = if keep_marker {
        u64::from(first)
    } else {
        u64::from(first) & (0xff_u64 >> width)
    };
    for index in 1..width {
        value = (value << 8) | u64::from(*bytes.get(*offset + index)?);
    }
    *offset += width;
    Some(value)
}
pub(crate) fn classify(bytes: &[u8]) -> Result<Family, AttemptFailure> {
    if bytes.len() >= 16 && &bytes[4..8] == b"ftyp" {
        let size = u32::from_be_bytes(bytes[..4].try_into().map_err(|_| unsupported())?) as usize;
        if size < 16 || size > bytes.len() || !(size - 16).is_multiple_of(4) {
            return Err(unsupported());
        }
        const BRANDS: &[[u8; 4]] = &[
            *b"isom", *b"iso2", *b"iso3", *b"iso4", *b"iso5", *b"iso6", *b"mp41", *b"mp42",
            *b"avc1", *b"M4V ", *b"M4A ", *b"qt  ", *b"dash", *b"MSNV", *b"3gp4", *b"3gp5",
            *b"3gp6", *b"3g2a",
        ];
        if !std::iter::once(&bytes[8..12])
            .chain(bytes[16..size].chunks_exact(4))
            .all(|brand| BRANDS.iter().any(|allowed| brand == allowed))
        {
            return Err(unsupported());
        }
        return Ok(Family::Mov);
    }
    if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        let mut offset = 4;
        let size = usize::try_from(vint(bytes, &mut offset, false).ok_or_else(unsupported)?)
            .map_err(|_| unsupported())?;
        let end = offset
            .checked_add(size)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(unsupported)?;
        let mut doc_type = None;
        while offset < end {
            let id = vint(&bytes[..end], &mut offset, true).ok_or_else(unsupported)?;
            let size =
                usize::try_from(vint(&bytes[..end], &mut offset, false).ok_or_else(unsupported)?)
                    .map_err(|_| unsupported())?;
            let next = offset
                .checked_add(size)
                .filter(|next| *next <= end)
                .ok_or_else(unsupported)?;
            if id == 0x4282 {
                if doc_type.is_some() {
                    return Err(unsupported());
                }
                doc_type = Some(&bytes[offset..next]);
            }
            offset = next;
        }
        if matches!(doc_type, Some(b"webm" | b"matroska")) {
            return Ok(Family::Matroska);
        }
    }
    Err(unsupported())
}
pub(super) async fn family(
    storage: &MediaService,
    input: &LocalFile,
) -> Result<Family, AttemptFailure> {
    let permit = storage
        .workers
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| AttemptFailure::new(FailureCode::Worker, e))?;
    let mut file = input
        .handle()
        .try_clone()
        .map_err(|e| AttemptFailure::new(FailureCode::FileAccess, e))?;
    let max = storage.config.max_input_bytes;
    storage
        .blocking(move || {
            let _permit = permit;
            if file
                .metadata()
                .map_err(|e| AttemptFailure::new(FailureCode::FileAccess, e))?
                .len()
                > max
            {
                return Err(AttemptFailure::new(
                    FailureCode::Limit,
                    "video input byte budget",
                ));
            }
            file.rewind()
                .map_err(|e| AttemptFailure::new(FailureCode::FileAccess, e))?;
            let mut bytes = Vec::new();
            file.take(64 * 1024)
                .read_to_end(&mut bytes)
                .map_err(|e| AttemptFailure::new(FailureCode::FileAccess, e))?;
            classify(&bytes)
        })
        .await
        .map_err(|e| AttemptFailure::new(FailureCode::Worker, e))?
}

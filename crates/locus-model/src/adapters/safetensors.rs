use super::strict_json::Strict;
use crate::{
    error::{AttemptFailure, FailureCode},
    record::{COVERAGE, Inspection, TensorDescriptor},
};
use safetensors::tensor::Metadata;
use std::io::Read;
const MAX_HEADER: u64 = 100_000_000;
fn io(e: std::io::Error) -> AttemptFailure {
    AttemptFailure::new(FailureCode::FileAccess, e)
}
fn invalid(e: impl ToString) -> AttemptFailure {
    AttemptFailure::new(FailureCode::Structure, e)
}
/// The caller obtains extent from the same File-owned open handle. Only nine
/// bytes are consumed; a short file is a completed bounded negative observation.
pub(crate) fn recognize(reader: &mut impl Read, extent: u64) -> Result<bool, AttemptFailure> {
    if extent < 9 {
        return Ok(false);
    }
    let mut prefix = [0; 9];
    reader.read_exact(&mut prefix).map_err(io)?;
    let mut n = [0; 8];
    n.copy_from_slice(&prefix[..8]);
    let n = u64::from_le_bytes(n);
    Ok((2..=MAX_HEADER).contains(&n) && prefix[8] == b'{')
}
pub(crate) fn inspect(reader: &mut impl Read, extent: u64) -> Result<Inspection, AttemptFailure> {
    if extent < 8 {
        return Err(invalid("truncated SafeTensors length prefix"));
    }
    let mut prefix = [0; 8];
    reader.read_exact(&mut prefix).map_err(io)?;
    let n = u64::from_le_bytes(prefix);
    if !(2..=MAX_HEADER).contains(&n) {
        return Err(invalid("unsupported SafeTensors header length"));
    }
    if n.checked_add(8).is_none_or(|v| v > extent) {
        return Err(invalid("truncated SafeTensors header"));
    }
    let mut header = vec![0; n as usize];
    reader.read_exact(&mut header).map_err(io)?;
    if header[0] != b'{' {
        return Err(invalid("SafeTensors header must begin with an object"));
    }
    let strict: Strict = serde_json::from_slice(&header).map_err(invalid)?;
    let object = strict
        .0
        .as_object()
        .ok_or_else(|| invalid("header must be an object"))?;
    for (name, value) in object {
        if name == "__metadata__" {
            if value
                .as_object()
                .is_none_or(|m| m.values().any(|v| !v.is_string()))
            {
                return Err(invalid("embedded metadata must be a string map"));
            }
        } else {
            let fields = value
                .as_object()
                .ok_or_else(|| invalid("tensor descriptor must be an object"))?;
            if fields.len() != 3
                || !["dtype", "shape", "data_offsets"]
                    .iter()
                    .all(|k| fields.contains_key(*k))
            {
                return Err(invalid("incomplete or unsupported tensor descriptor"));
            }
        }
    }
    // Metadata deserialization calls its checked validation, including bit sizes,
    // complete nonoverlapping offsets and arithmetic overflow, without a body slice.
    let metadata: Metadata = serde_json::from_value(strict.0).map_err(invalid)?;
    if (metadata.data_len() as u64).checked_add(n + 8) != Some(extent) {
        return Err(invalid(
            "data extent does not match the complete declared tensor coverage",
        ));
    }
    let mut tensors: Vec<_> = metadata
        .tensors()
        .into_iter()
        .map(|(name, t)| TensorDescriptor {
            name,
            shape: t.shape.iter().map(|v| *v as u64).collect(),
            storage_type: t.dtype.to_string(),
        })
        .collect();
    tensors.sort_by(|a, b| a.name.cmp(&b.name));
    let (element_count, storage_types) = Inspection::summarize(&tensors).map_err(invalid)?;
    Ok(Inspection {
        format: "SafeTensors".into(),
        coverage: COVERAGE.into(),
        tensor_count: tensors.len() as u64,
        tensors,
        element_count,
        storage_types,
        declarations: metadata
            .metadata()
            .as_ref()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect()),
    })
}

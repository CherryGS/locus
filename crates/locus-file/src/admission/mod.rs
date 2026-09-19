mod copy;
mod prepared;
mod register;

pub use prepared::{AdmissionFailure, CopyProgress, PreparedFile};

#[cfg(test)]
mod tests;

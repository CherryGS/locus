mod command;
mod cover;
mod identify;
mod metadata;

pub(crate) use cover::cover;
pub(crate) use metadata::inspect;

#[cfg(test)]
pub(crate) use identify::Family;
#[cfg(test)]
pub(crate) use metadata::parse;
#[cfg(test)]
mod tests;

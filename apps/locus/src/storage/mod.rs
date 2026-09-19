mod application;
mod config;

pub use application::ApplicationStorage;
pub use config::configured_root;

#[cfg(test)]
mod tests;

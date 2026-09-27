#[derive(Clone, Default)]
pub struct ModelService {
    pub(crate) stage: Option<locus_task::api::Stage>,
}
impl ModelService {
    pub fn new() -> Self {
        Self::default()
    }
}

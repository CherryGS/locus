use super::fixtures;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    All,
    Media,
    Models,
    Favorites,
    Studio,
    Landscape,
    Issues,
}
impl Scope {
    pub fn title(self) -> &'static str {
        match self {
            Self::All => "全部资源",
            Self::Media => "图像与媒体",
            Self::Models => "模型权重",
            Self::Favorites => "我的收藏",
            Self::Studio => "创作工作室",
            Self::Landscape => "自然与风景",
            Self::Issues => "需要关注",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Category {
    Image,
    Model,
}
impl Category {
    pub fn label(self) -> &'static str {
        match self {
            Self::Image => "图像",
            Self::Model => "模型",
        }
    }
}

// These deliberately small records are presentation fixtures, not domain schemas.
pub struct Resource {
    pub id: usize,
    pub name: &'static str,
    pub category: Category,
    pub collection: &'static str,
    pub subtitle: &'static str,
    pub color: u32,
    pub artwork: usize,
    pub favorite: bool,
    pub issue: Option<&'static str>,
    pub file: Option<FileFacts>,
    pub image: Option<ImageFacts>,
    pub generation: Option<GenerationFacts>,
    pub model: Option<ModelFacts>,
    pub source: Option<SourceFacts>,
    pub note: String,
    pub tags: Vec<String>,
}
pub struct FileFacts {
    pub filename: String,
    pub format: &'static str,
    pub size: &'static str,
}
pub struct ImageFacts {
    pub dimensions: &'static str,
    pub color: &'static str,
}
pub struct GenerationFacts {
    pub prompt: &'static str,
    pub model: &'static str,
    pub seed: &'static str,
}
pub struct ModelFacts {
    pub architecture: &'static str,
    pub version: &'static str,
    pub precision: &'static str,
}
pub struct SourceFacts {
    pub name: &'static str,
    pub reference: &'static str,
    pub status: &'static str,
}

pub struct Library {
    pub resources: Vec<Resource>,
    pub scope: Scope,
    pub query: String,
    pub issues_only: bool,
    pub alphabetical: bool,
    pub selected: Option<usize>,
}
impl Library {
    pub fn new() -> Self {
        Self {
            resources: fixtures::resources(),
            scope: Scope::All,
            query: String::new(),
            issues_only: false,
            alphabetical: false,
            selected: Some(0),
        }
    }
    pub fn in_scope(resource: &Resource, scope: Scope) -> bool {
        match scope {
            Scope::All => true,
            Scope::Media => resource.category == Category::Image,
            Scope::Models => resource.category == Category::Model,
            Scope::Favorites => resource.favorite,
            Scope::Studio => resource
                .source
                .as_ref()
                .is_some_and(|source| source.name == "创作工作室"),
            Scope::Landscape => resource.collection == "自然与风景",
            Scope::Issues => resource.issue.is_some(),
        }
    }
    pub fn visible(&self) -> Vec<usize> {
        let query = self.query.trim().to_lowercase();
        let mut visible: Vec<_> = self
            .resources
            .iter()
            .filter(|item| {
                Self::in_scope(item, self.scope)
                    && (!self.issues_only || item.issue.is_some())
                    && (query.is_empty()
                        || format!(
                            "{} {} {} {}",
                            item.name,
                            item.subtitle,
                            item.collection,
                            item.tags.join(" ")
                        )
                        .to_lowercase()
                        .contains(&query))
            })
            .map(|item| item.id)
            .collect();
        if self.alphabetical {
            visible.sort_by_key(|&id| self.resources[id].name);
        }
        visible
    }
    pub fn reconcile(&mut self) {
        let visible = self.visible();
        if !self.selected.is_some_and(|id| visible.contains(&id)) {
            self.selected = visible.first().copied();
        }
    }
    pub fn reset(&mut self) {
        self.scope = Scope::All;
        self.query.clear();
        self.issues_only = false;
        self.reconcile();
    }
    pub fn add_tag(&mut self, id: usize, text: &str) -> bool {
        let tag = text.trim();
        let Some(item) = self.resources.get_mut(id) else {
            return false;
        };
        if tag.is_empty()
            || item
                .tags
                .iter()
                .any(|existing| existing.to_lowercase() == tag.to_lowercase())
        {
            return false;
        }
        item.tags.push(tag.to_owned());
        true
    }
    pub fn set_note(&mut self, id: usize, text: String) {
        if let Some(item) = self.resources.get_mut(id) {
            item.note = text;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filtering_preserves_visible_selection_and_clears_empty_results() {
        let mut library = Library::new();
        library.selected = Some(2);
        library.scope = Scope::Media;
        library.reconcile();
        assert_eq!(library.selected, Some(2));
        library.query = "不存在的资源".into();
        library.reconcile();
        assert_eq!(library.selected, None);
        library.reset();
        assert_eq!(library.selected, Some(0));
    }
    #[test]
    fn annotations_are_addressed_to_their_resource_even_after_selection_changes() {
        let mut library = Library::new();
        library.set_note(0, "first draft".into());
        library.selected = Some(1);
        library.set_note(0, "late first edit".into());
        library.set_note(1, "second draft".into());
        assert_eq!(library.resources[0].note, "late first edit");
        assert_eq!(library.resources[1].note, "second draft");
        assert!(library.add_tag(0, "  New tag  "));
        assert!(!library.add_tag(0, "new TAG"));
        assert!(!library.add_tag(0, "   "));
        assert!(!library.resources[1].tags.iter().any(|tag| tag == "New tag"));
    }
    #[test]
    fn scope_filters_and_favorites_compose() {
        let mut library = Library::new();
        library.scope = Scope::Favorites;
        library.query = "山".into();
        library.reconcile();
        assert_eq!(library.visible(), vec![0]);
        library.resources[0].favorite = false;
        library.reconcile();
        assert!(library.visible().is_empty());
        assert_eq!(library.selected, None);
    }
}

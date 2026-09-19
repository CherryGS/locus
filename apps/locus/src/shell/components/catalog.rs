use super::super::{state::Resource, view::*};
use gpui_kit::*;

pub struct PanelDescriptor {
    pub key: &'static str,
    pub title: &'static str,
    pub subtitle: &'static str,
    pub applies: fn(&Resource) -> bool,
    pub render: fn(&Resource) -> AnyElement,
}
pub const PANELS: &[PanelDescriptor] = &[
    PanelDescriptor {
        key: "file",
        title: "文件",
        subtitle: "File",
        applies: |item| item.file.is_some(),
        render: super::file::render,
    },
    PanelDescriptor {
        key: "image",
        title: "图像",
        subtitle: "Image",
        applies: |item| item.image.is_some(),
        render: super::image::render,
    },
    PanelDescriptor {
        key: "generation",
        title: "生成信息",
        subtitle: "Generation",
        applies: |item| item.generation.is_some(),
        render: super::generation::render,
    },
    PanelDescriptor {
        key: "model",
        title: "模型权重",
        subtitle: "Model",
        applies: |item| item.model.is_some(),
        render: super::model::render,
    },
    PanelDescriptor {
        key: "source",
        title: "来源",
        subtitle: "Source",
        applies: |item| item.source.is_some(),
        render: super::source::render,
    },
];

pub fn fact(label: &'static str, value: impl Into<SharedString>) -> Div {
    row()
        .items_start()
        .gap_3()
        .text_size(px(11.))
        .py_1()
        .child(
            div()
                .w(px(67.))
                .flex_shrink_0()
                .text_color(rgb(MUTED))
                .child(label),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .overflow_hidden()
                .child(value.into()),
        )
}

#[cfg(test)]
mod tests {
    use super::PANELS;
    #[test]
    fn panel_composition_tracks_supplied_components_and_incomplete_samples() {
        let library = super::super::super::state::Library::new();
        let keys = |id| {
            PANELS
                .iter()
                .filter(|panel| (panel.applies)(&library.resources[id]))
                .map(|panel| panel.key)
                .collect::<Vec<_>>()
        };
        assert_eq!(keys(0), vec!["file", "image", "generation", "source"]);
        assert_eq!(keys(6), vec!["file", "model", "source"]);
        assert_eq!(keys(10), vec!["file", "image", "source"]);
        assert!(!keys(5).contains(&"source"));
    }
}
